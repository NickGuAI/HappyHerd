#define _DARWIN_C_SOURCE

#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <errno.h>
#include <grp.h>
#include <limits.h>
#include <pwd.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#define HOST_VERSION "1"
#define MASTER_SERVICE "dev.happyherd.keychain-master.v1"
#define SYSTEM_KEYCHAIN "/Library/Keychains/System.keychain"

static void fail(const char *message) {
  fprintf(stderr, "happyherd keychain broker: %s\n", message);
  exit(1);
}

static void fail_status(const char *message, OSStatus status) {
  fprintf(stderr, "happyherd keychain broker: %s (%d)\n", message, (int)status);
  exit(1);
}

static unsigned long parse_id(const char *value, const char *label) {
  char *end = NULL;
  errno = 0;
  unsigned long parsed = strtoul(value, &end, 10);
  if (errno != 0 || end == value || *end != '\0' || parsed == 0 || parsed > UINT32_MAX) {
    fail(label);
  }
  return parsed;
}

static void exact_path(char *output, size_t size, const char *format, unsigned long owner_uid) {
  int written = snprintf(output, size, format, owner_uid);
  if (written < 1 || (size_t)written >= size) fail("configured path is too long");
}

static void require_exact_path(const char *actual, const char *expected, const char *label) {
  if (actual[0] != '/' || strcmp(actual, expected) != 0) fail(label);
}

static void require_directory(const char *path, uid_t owner, mode_t expected_mode, const char *label) {
  struct stat value;
  if (lstat(path, &value) != 0 || !S_ISDIR(value.st_mode) || S_ISLNK(value.st_mode)
      || value.st_uid != owner || (value.st_mode & 0777) != expected_mode) {
    fail(label);
  }
}

static void require_regular(const char *path, uid_t owner, bool executable, const char *label) {
  struct stat value;
  if (lstat(path, &value) != 0 || !S_ISREG(value.st_mode) || S_ISLNK(value.st_mode)
      || value.st_uid != owner || (value.st_mode & 0022) != 0
      || (executable && (value.st_mode & 0111) == 0)) {
    fail(label);
  }
}

static char *environment_assignment(const char *name, const char *value) {
  size_t name_length = strlen(name), value_length = strlen(value);
  char *assignment = malloc(name_length + value_length + 2);
  if (assignment == NULL) fail("could not allocate the isolated broker environment");
  memcpy(assignment, name, name_length);
  assignment[name_length] = '=';
  memcpy(assignment + name_length + 1, value, value_length + 1);
  return assignment;
}

static void ensure_service_directory(const char *path, uid_t uid, gid_t gid) {
  struct stat value;
  if (lstat(path, &value) == 0) {
    require_directory(path, uid, 0700, "existing service Keychain directory is unsafe");
    if (value.st_gid != gid) fail("existing service Keychain directory group is unsafe");
    return;
  }
  if (errno != ENOENT || mkdir(path, 0700) != 0 || chown(path, uid, gid) != 0 || chmod(path, 0700) != 0) {
    fail("could not create the protected service Keychain directory");
  }
}

static void account_name(char *output, size_t size, unsigned long owner_uid) {
  int written = snprintf(output, size, "uid:%lu", owner_uid);
  if (written < 1 || (size_t)written >= size) fail("Keychain master account is invalid");
}

static SecKeychainRef open_system_keychain(void) {
  SecKeychainRef keychain = NULL;
  OSStatus status = SecKeychainOpen(SYSTEM_KEYCHAIN, &keychain);
  if (status != errSecSuccess || keychain == NULL) fail_status("could not open the System Keychain", status);
  return keychain;
}

static OSStatus find_master(
  SecKeychainRef system_keychain,
  const char *account,
  UInt32 *length,
  void **bytes,
  SecKeychainItemRef *item
) {
  return SecKeychainFindGenericPassword(
    system_keychain,
    (UInt32)strlen(MASTER_SERVICE), MASTER_SERVICE,
    (UInt32)strlen(account), account,
    length, bytes, item
  );
}

static void lock_memory(void *bytes, size_t length) {
  volatile uint8_t *cursor = (volatile uint8_t *)bytes;
  while (cursor != NULL && length > 0) {
    *cursor++ = 0;
    length -= 1;
  }
}

static void add_master(
  SecKeychainRef system_keychain,
  const char *account,
  const uint8_t *master,
  UInt32 master_length
) {
  SecKeychainItemRef item = NULL;
  OSStatus status = SecKeychainAddGenericPassword(
    system_keychain,
    (UInt32)strlen(MASTER_SERVICE), MASTER_SERVICE,
    (UInt32)strlen(account), account,
    master_length, master, &item
  );
  if (status != errSecSuccess || item == NULL) fail_status("could not seal the service Keychain master", status);

  SecTrustedApplicationRef application = NULL;
  SecAccessRef access = NULL;
  CFArrayRef trusted = NULL;
  status = SecTrustedApplicationCreateFromPath(NULL, &application);
  if (status == errSecSuccess && application != NULL) {
    const void *values[] = { application };
    trusted = CFArrayCreate(kCFAllocatorDefault, values, 1, &kCFTypeArrayCallBacks);
  }
  if (status == errSecSuccess && trusted != NULL) {
    status = SecAccessCreate(CFSTR("HappyHerd broker Keychain master"), trusted, &access);
  }
  if (status == errSecSuccess && access != NULL) status = SecKeychainItemSetAccess(item, access);
  if (status != errSecSuccess) {
    (void)SecKeychainItemDelete(item);
    if (access != NULL) CFRelease(access);
    if (trusted != NULL) CFRelease(trusted);
    if (application != NULL) CFRelease(application);
    CFRelease(item);
    fail_status("could not restrict the service Keychain master to the protected broker host", status);
  }
  CFRelease(access);
  CFRelease(trusted);
  CFRelease(application);
  CFRelease(item);
}

static void initialize_keychain(
  unsigned long owner_uid,
  uid_t service_uid,
  gid_t service_gid,
  const char *state_root,
  const char *keychain_path
) {
  char account[64];
  account_name(account, sizeof(account), owner_uid);
  SecKeychainRef system_keychain = open_system_keychain();
  UInt32 old_length = 0;
  void *old_bytes = NULL;
  SecKeychainItemRef old_item = NULL;
  OSStatus existing = find_master(system_keychain, account, &old_length, &old_bytes, &old_item);
  if (existing == errSecSuccess) {
    require_regular(keychain_path, service_uid, false, "existing service Keychain file is unsafe");
    SecKeychainRef custom = NULL;
    OSStatus status = SecKeychainOpen(keychain_path, &custom);
    if (status == errSecSuccess) status = SecKeychainUnlock(custom, old_length, old_bytes, false);
    lock_memory(old_bytes, old_length);
    if (old_bytes != NULL) SecKeychainItemFreeContent(NULL, old_bytes);
    if (old_item != NULL) CFRelease(old_item);
    if (custom != NULL) CFRelease(custom);
    CFRelease(system_keychain);
    if (status != errSecSuccess) fail_status("existing service Keychain could not be unlocked", status);
    return;
  }
  if (existing != errSecItemNotFound) fail_status("could not inspect the service Keychain master", existing);
  if (access(keychain_path, F_OK) == 0) fail("service Keychain exists without its System Keychain master");

  char library_path[PATH_MAX];
  char keychains_path[PATH_MAX];
  int library_length = snprintf(library_path, sizeof(library_path), "%s/Library", state_root);
  int keychains_length = snprintf(keychains_path, sizeof(keychains_path), "%s/Library/Keychains", state_root);
  if (library_length < 1 || (size_t)library_length >= sizeof(library_path)
      || keychains_length < 1 || (size_t)keychains_length >= sizeof(keychains_path)) {
    fail("service Keychain directory path is too long");
  }
  ensure_service_directory(library_path, service_uid, service_gid);
  ensure_service_directory(keychains_path, service_uid, service_gid);

  uint8_t master[32];
  OSStatus status = SecRandomCopyBytes(kSecRandomDefault, sizeof(master), master);
  if (status != errSecSuccess) fail_status("could not generate the service Keychain master", status);
  SecKeychainRef custom = NULL;
  status = SecKeychainCreate(keychain_path, (UInt32)sizeof(master), master, false, NULL, &custom);
  if (status != errSecSuccess || custom == NULL) {
    lock_memory(master, sizeof(master));
    fail_status("could not create the service Keychain", status);
  }
  if (chown(keychain_path, service_uid, service_gid) != 0 || chmod(keychain_path, 0600) != 0) {
    (void)SecKeychainDelete(custom);
    CFRelease(custom);
    lock_memory(master, sizeof(master));
    fail("could not protect the service Keychain file");
  }
  add_master(system_keychain, account, master, (UInt32)sizeof(master));
  lock_memory(master, sizeof(master));
  CFRelease(custom);
  CFRelease(system_keychain);
}

static void run_broker(
  unsigned long owner_uid,
  uid_t service_uid,
  gid_t service_gid,
  const char *state_root,
  const char *keychain_path,
  const char *node_runtime,
  const char *broker_script,
  const char *broker_config
) {
  require_directory(state_root, service_uid, 0710, "broker state root is unsafe");
  require_regular(keychain_path, service_uid, false, "service Keychain file is unsafe");
  require_regular(node_runtime, 0, true, "bundled Node runtime is unsafe");
  require_regular(broker_script, 0, false, "broker script is unsafe");
  require_regular(broker_config, service_uid, false, "broker configuration is unsafe");

  char account[64];
  account_name(account, sizeof(account), owner_uid);
  SecKeychainRef system_keychain = open_system_keychain();
  UInt32 master_length = 0;
  void *master = NULL;
  SecKeychainItemRef item = NULL;
  OSStatus status = find_master(system_keychain, account, &master_length, &master, &item);
  if (status != errSecSuccess) fail_status("could not retrieve the service Keychain master", status);
  SecKeychainRef custom = NULL;
  status = SecKeychainOpen(keychain_path, &custom);
  if (status == errSecSuccess) status = SecKeychainUnlock(custom, master_length, master, false);
  lock_memory(master, master_length);
  if (master != NULL) SecKeychainItemFreeContent(NULL, master);
  if (item != NULL) CFRelease(item);
  if (custom != NULL) CFRelease(custom);
  CFRelease(system_keychain);
  if (status != errSecSuccess) fail_status("could not unlock the durable service Keychain", status);

  if (setgroups(1, &service_gid) != 0 || setgid(service_gid) != 0 || setuid(service_uid) != 0
      || getuid() != service_uid || geteuid() != service_uid || getgid() != service_gid || getegid() != service_gid) {
    fail("could not drop to the isolated broker identity");
  }
  char *clean_environment[] = {
    environment_assignment("HOME", state_root),
    environment_assignment("HAPPYHERD_KEYRING_TARGET", keychain_path),
    environment_assignment("HAPPYHERD_NATIVE_INSTALLATION", "1"),
    environment_assignment("PATH", "/usr/bin:/bin"),
    NULL,
  };
  char *const arguments[] = {
    (char *)node_runtime,
    (char *)broker_script,
    (char *)"broker-service",
    (char *)"--config",
    (char *)broker_config,
    NULL,
  };
  execve(node_runtime, arguments, clean_environment);
  fail("could not execute the protected broker runtime");
}

/*
 * Destruction is deliberately retryable across the only non-atomic boundary:
 * the custom Keychain is removed before its System Keychain master.  A failed
 * custom deletion preserves the master.  If master deletion then fails, a
 * later invocation accepts the already-absent custom Keychain and retries the
 * master deletion.  Both artifacts absent is the idempotent success state.
 */
static void destroy_keychain(unsigned long owner_uid, uid_t service_uid, const char *keychain_path) {
  char account[64];
  account_name(account, sizeof(account), owner_uid);
  SecKeychainRef system_keychain = open_system_keychain();
  UInt32 master_length = 0;
  void *master = NULL;
  SecKeychainItemRef item = NULL;
  OSStatus status = find_master(system_keychain, account, &master_length, &master, &item);
  if (status == errSecItemNotFound) {
    struct stat value;
    if (lstat(keychain_path, &value) == 0 || errno != ENOENT) {
      CFRelease(system_keychain);
      fail("service Keychain exists without its System Keychain master");
    }
    CFRelease(system_keychain);
    return;
  }
  if (status != errSecSuccess) fail_status("could not find the service Keychain master for deletion", status);
  lock_memory(master, master_length);
  if (master != NULL) SecKeychainItemFreeContent(NULL, master);

  struct stat keychain_metadata;
  if (lstat(keychain_path, &keychain_metadata) == 0) {
    require_regular(keychain_path, service_uid, false, "service Keychain file is unsafe");
    SecKeychainRef custom = NULL;
    status = SecKeychainOpen(keychain_path, &custom);
    if (status == errSecSuccess) status = SecKeychainDelete(custom);
    if (custom != NULL) CFRelease(custom);
    if (status != errSecSuccess) fail_status("could not delete the service Keychain; its master was preserved", status);
    if (lstat(keychain_path, &keychain_metadata) == 0 || errno != ENOENT) {
      fail("service Keychain deletion was not durable; its master was preserved");
    }
  } else if (errno != ENOENT) {
    fail("could not inspect the service Keychain for deletion; its master was preserved");
  }

  status = SecKeychainItemDelete(item);
  if (item != NULL) CFRelease(item);
  CFRelease(system_keychain);
  if (status != errSecSuccess) fail_status("could not delete the service Keychain master", status);
}

int main(int argc, char **argv) {
  if (argc == 2 && strcmp(argv[1], "--version") == 0) {
    puts("happyherd-keychain-broker-v" HOST_VERSION);
    return 0;
  }
  if (geteuid() != 0) fail("the native Keychain broker host must be launched by root");
  if (argc < 7) fail("invalid native Keychain broker arguments");
  unsigned long owner_uid = parse_id(argv[2], "owner UID is invalid");
  uid_t service_uid = (uid_t)parse_id(argv[3], "service UID is invalid");
  gid_t service_gid = (gid_t)parse_id(argv[4], "service GID is invalid");
  if (owner_uid == service_uid) fail("broker identity overlaps the target user");

  char expected_state[PATH_MAX];
  char expected_keychain[PATH_MAX];
  exact_path(expected_state, sizeof(expected_state), "/Library/Application Support/HappyHerd/Broker/%lu", owner_uid);
  int keychain_length = snprintf(expected_keychain, sizeof(expected_keychain), "%s/Library/Keychains/happyherd.keychain-db", expected_state);
  if (keychain_length < 1 || (size_t)keychain_length >= sizeof(expected_keychain)) fail("service Keychain path is too long");
  require_exact_path(argv[5], expected_state, "state root does not match the target owner");
  require_exact_path(argv[6], expected_keychain, "service Keychain path does not match the target owner");

  if (strcmp(argv[1], "--initialize") == 0 && argc == 7) {
    require_directory(expected_state, service_uid, 0710, "broker state root is unsafe");
    initialize_keychain(owner_uid, service_uid, service_gid, expected_state, expected_keychain);
    return 0;
  }
  if (strcmp(argv[1], "--destroy") == 0 && argc == 7) {
    destroy_keychain(owner_uid, service_uid, expected_keychain);
    return 0;
  }
  if (strcmp(argv[1], "--run") == 0 && argc == 10) {
    char expected_install_prefix[PATH_MAX];
    exact_path(expected_install_prefix, sizeof(expected_install_prefix), "/Library/Application Support/HappyHerd/%lu/", owner_uid);
    if (strncmp(argv[7], expected_install_prefix, strlen(expected_install_prefix)) != 0
        || strncmp(argv[8], expected_install_prefix, strlen(expected_install_prefix)) != 0) {
      fail("broker runtime is outside the protected owner installation");
    }
    char expected_config[PATH_MAX];
    int config_length = snprintf(expected_config, sizeof(expected_config), "%s/broker-service.json", expected_state);
    if (config_length < 1 || (size_t)config_length >= sizeof(expected_config)) fail("broker config path is too long");
    require_exact_path(argv[9], expected_config, "broker config does not match the protected service state");
    run_broker(owner_uid, service_uid, service_gid, expected_state, expected_keychain, argv[7], argv[8], argv[9]);
  }
  fail("unsupported native Keychain broker operation");
  return 1;
}
