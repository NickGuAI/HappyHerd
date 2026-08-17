#define _DARWIN_C_SOURCE

#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <limits.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#define HOST_VERSION "1"
#define RANDOM_MASTER_LENGTH 32
#define MASTER_LENGTH 64
#define SECRET_ROOT "/Library/Application Support/HappyHerd/Secrets"

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

static void require_exact_directory(
  const char *path,
  uid_t owner,
  gid_t group,
  mode_t expected_mode,
  const char *label
) {
  struct stat value;
  if (lstat(path, &value) != 0 || !S_ISDIR(value.st_mode) || S_ISLNK(value.st_mode)
      || value.st_uid != owner || value.st_gid != group
      || (value.st_mode & 0777) != expected_mode) {
    fail(label);
  }
}

static void require_regular(const char *path, uid_t owner, bool executable, const char *label) {
  struct stat value;
  if (lstat(path, &value) != 0 || !S_ISREG(value.st_mode) || S_ISLNK(value.st_mode)
      || value.st_nlink != 1 || value.st_uid != owner || (value.st_mode & 0022) != 0
      || (executable && (value.st_mode & 0111) == 0)) {
    fail(label);
  }
}

static void require_exact_regular(
  const char *path,
  uid_t owner,
  gid_t group,
  mode_t expected_mode,
  off_t expected_size,
  const char *label
) {
  struct stat value;
  if (lstat(path, &value) != 0 || !S_ISREG(value.st_mode) || S_ISLNK(value.st_mode)
      || value.st_nlink != 1 || value.st_uid != owner || value.st_gid != group
      || (value.st_mode & 0777) != expected_mode
      || (expected_size >= 0 && value.st_size != expected_size)) {
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

static bool keychain_has_exact_path(SecKeychainRef keychain, const char *expected_path) {
  if (keychain == NULL || CFGetTypeID(keychain) != SecKeychainGetTypeID()) return false;
  char actual_path[PATH_MAX];
  UInt32 path_length = (UInt32)sizeof(actual_path);
  OSStatus status = SecKeychainGetPath(keychain, &path_length, actual_path);
  if (status != errSecSuccess || path_length >= sizeof(actual_path)) return false;
  actual_path[path_length] = '\0';
  return strcmp(actual_path, expected_path) == 0;
}

static void ensure_service_directory(const char *path, uid_t uid, gid_t gid) {
  struct stat value;
  if (lstat(path, &value) == 0) {
    require_exact_directory(path, uid, gid, 0700, "existing service Keychain directory is unsafe");
    return;
  }
  if (errno != ENOENT || mkdir(path, 0700) != 0 || chown(path, uid, gid) != 0 || chmod(path, 0700) != 0) {
    fail("could not create the protected service Keychain directory");
  }
  require_exact_directory(path, uid, gid, 0700, "created service Keychain directory is unsafe");
}

static void ensure_root_secret_directory(const char *path) {
  struct stat value;
  if (lstat(path, &value) == 0) {
    require_exact_directory(path, 0, 0, 0700, "existing Keychain master directory is unsafe");
    return;
  }
  if (errno != ENOENT || mkdir(path, 0700) != 0 || chown(path, 0, 0) != 0 || chmod(path, 0700) != 0) {
    fail("could not create the protected Keychain master directory");
  }
  require_exact_directory(path, 0, 0, 0700, "created Keychain master directory is unsafe");
}

static bool path_exists(const char *path) {
  struct stat value;
  if (lstat(path, &value) == 0) return true;
  if (errno == ENOENT) return false;
  fail("could not inspect protected Keychain state");
  return false;
}

static void lock_memory(void *bytes, size_t length) {
  volatile uint8_t *cursor = (volatile uint8_t *)bytes;
  while (cursor != NULL && length > 0) {
    *cursor++ = 0;
    length -= 1;
  }
}

static void encode_master(
  const uint8_t random_master[RANDOM_MASTER_LENGTH],
  uint8_t master[MASTER_LENGTH]
) {
  static const uint8_t hexadecimal[] = "0123456789abcdef";
  for (size_t index = 0; index < RANDOM_MASTER_LENGTH; index += 1) {
    master[index * 2] = hexadecimal[random_master[index] >> 4];
    master[index * 2 + 1] = hexadecimal[random_master[index] & 0x0f];
  }
}

static void read_master(const char *master_path, uint8_t master[MASTER_LENGTH]) {
  require_exact_regular(master_path, 0, 0, 0400, MASTER_LENGTH, "Keychain master file is unsafe");
  int descriptor = open(master_path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (descriptor < 0) fail("could not open the Keychain master file");
  struct stat value;
  if (fstat(descriptor, &value) != 0 || !S_ISREG(value.st_mode) || value.st_nlink != 1
      || value.st_uid != 0 || value.st_gid != 0 || (value.st_mode & 0777) != 0400
      || value.st_size != MASTER_LENGTH) {
    close(descriptor);
    fail("opened Keychain master file changed identity");
  }
  size_t offset = 0;
  while (offset < MASTER_LENGTH) {
    ssize_t count = read(descriptor, master + offset, MASTER_LENGTH - offset);
    if (count <= 0) {
      lock_memory(master, MASTER_LENGTH);
      close(descriptor);
      fail("could not read the complete Keychain master file");
    }
    offset += (size_t)count;
  }
  uint8_t extra = 0;
  if (read(descriptor, &extra, 1) != 0 || close(descriptor) != 0) {
    lock_memory(master, MASTER_LENGTH);
    fail("Keychain master file has an invalid length");
  }
}

static void write_master(const char *master_path, const uint8_t master[MASTER_LENGTH]) {
  int descriptor = open(master_path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0400);
  if (descriptor < 0) fail("could not create the Keychain master file");
  bool valid = fchown(descriptor, 0, 0) == 0 && fchmod(descriptor, 0400) == 0;
  size_t offset = 0;
  while (valid && offset < MASTER_LENGTH) {
    ssize_t count = write(descriptor, master + offset, MASTER_LENGTH - offset);
    if (count <= 0) valid = false;
    else offset += (size_t)count;
  }
  if (valid && fsync(descriptor) != 0) valid = false;
  if (close(descriptor) != 0) valid = false;
  if (!valid) {
    (void)unlink(master_path);
    fail("could not persist the complete Keychain master file");
  }
  require_exact_regular(master_path, 0, 0, 0400, MASTER_LENGTH, "created Keychain master file is unsafe");
}

static void initialize_keychain(
  uid_t service_uid,
  gid_t service_gid,
  const char *state_root,
  const char *keychain_path,
  const char *master_owner_dir,
  const char *master_path
) {
  require_exact_directory("/Library/Application Support/HappyHerd", 0, 0, 0755, "HappyHerd system root is unsafe");
  ensure_root_secret_directory(SECRET_ROOT);
  ensure_root_secret_directory(master_owner_dir);
  bool master_exists = path_exists(master_path);
  bool keychain_exists = path_exists(keychain_path);
  if (!master_exists && keychain_exists) fail("service Keychain exists without its protected unlock master");
  if (keychain_exists) {
    require_exact_regular(keychain_path, service_uid, service_gid, 0600, -1, "existing service Keychain file is unsafe");
  }

  uint8_t master[MASTER_LENGTH] = {0};
  if (master_exists) read_master(master_path, master);
  else {
    uint8_t random_master[RANDOM_MASTER_LENGTH] = {0};
    OSStatus status = SecRandomCopyBytes(kSecRandomDefault, RANDOM_MASTER_LENGTH, random_master);
    if (status != errSecSuccess) {
      lock_memory(random_master, RANDOM_MASTER_LENGTH);
      fail_status("could not generate the service Keychain unlock master", status);
    }
    encode_master(random_master, master);
    lock_memory(random_master, RANDOM_MASTER_LENGTH);
    write_master(master_path, master);
  }

  char library_path[PATH_MAX];
  char keychains_path[PATH_MAX];
  char preferences_path[PATH_MAX];
  int library_length = snprintf(library_path, sizeof(library_path), "%s/Library", state_root);
  int keychains_length = snprintf(keychains_path, sizeof(keychains_path), "%s/Library/Keychains", state_root);
  int preferences_length = snprintf(preferences_path, sizeof(preferences_path), "%s/Library/Preferences", state_root);
  if (library_length < 1 || (size_t)library_length >= sizeof(library_path)
      || keychains_length < 1 || (size_t)keychains_length >= sizeof(keychains_path)
      || preferences_length < 1 || (size_t)preferences_length >= sizeof(preferences_path)) {
    lock_memory(master, MASTER_LENGTH);
    fail("service Keychain directory path is too long");
  }
  ensure_service_directory(library_path, service_uid, service_gid);
  ensure_service_directory(keychains_path, service_uid, service_gid);
  ensure_service_directory(preferences_path, service_uid, service_gid);

  if (keychain_exists) {
    SecKeychainRef custom = NULL;
    OSStatus status = SecKeychainOpen(keychain_path, &custom);
    if (status == errSecSuccess) status = SecKeychainUnlock(custom, MASTER_LENGTH, master, true);
    lock_memory(master, MASTER_LENGTH);
    if (custom != NULL) CFRelease(custom);
    if (status != errSecSuccess) fail_status("existing service Keychain could not be unlocked", status);
    return;
  }

  SecKeychainRef custom = NULL;
  OSStatus status = SecKeychainCreate(keychain_path, MASTER_LENGTH, master, false, NULL, &custom);
  if (status != errSecSuccess || custom == NULL) {
    lock_memory(master, MASTER_LENGTH);
    fail_status("could not create the service Keychain", status);
  }
  if (chown(keychain_path, service_uid, service_gid) != 0 || chmod(keychain_path, 0600) != 0) {
    (void)SecKeychainDelete(custom);
    CFRelease(custom);
    lock_memory(master, MASTER_LENGTH);
    fail("could not protect the service Keychain file");
  }
  require_exact_regular(keychain_path, service_uid, service_gid, 0600, -1, "created service Keychain file is unsafe");
  lock_memory(master, MASTER_LENGTH);
  CFRelease(custom);
}

static void run_broker(
  uid_t service_uid,
  gid_t service_gid,
  const char *state_root,
  const char *keychain_path,
  const char *master_owner_dir,
  const char *master_path,
  const char *node_runtime,
  const char *broker_script,
  const char *broker_config
) {
  require_exact_directory(state_root, service_uid, service_gid, 0710, "broker state root is unsafe");
  char preferences_path[PATH_MAX];
  int preferences_length = snprintf(preferences_path, sizeof(preferences_path), "%s/Library/Preferences", state_root);
  if (preferences_length < 1 || (size_t)preferences_length >= sizeof(preferences_path)) {
    fail("service Keychain Preferences path is too long");
  }
  require_exact_directory(preferences_path, service_uid, service_gid, 0700, "service Keychain Preferences directory is unsafe");
  require_exact_regular(keychain_path, service_uid, service_gid, 0600, -1, "service Keychain file is unsafe");
  require_exact_directory(SECRET_ROOT, 0, 0, 0700, "Keychain master root is unsafe");
  require_exact_directory(master_owner_dir, 0, 0, 0700, "Keychain master owner directory is unsafe");
  require_regular(node_runtime, 0, true, "bundled Node runtime is unsafe");
  require_regular(broker_script, 0, false, "broker script is unsafe");
  require_regular(broker_config, service_uid, false, "broker configuration is unsafe");

  uint8_t master[MASTER_LENGTH] = {0};
  read_master(master_path, master);
  SecKeychainRef custom = NULL;
  OSStatus status = SecKeychainOpen(keychain_path, &custom);
  if (status == errSecSuccess) status = SecKeychainUnlock(custom, MASTER_LENGTH, master, true);
  lock_memory(master, MASTER_LENGTH);
  if (status != errSecSuccess || custom == NULL) {
    if (custom != NULL) CFRelease(custom);
    fail_status("could not unlock the durable service Keychain", status);
  }

  if (setenv("HOME", state_root, 1) != 0) {
    CFRelease(custom);
    fail("could not select the isolated broker home");
  }
  if (setgroups(1, &service_gid) != 0 || setgid(service_gid) != 0 || setuid(service_uid) != 0
      || getuid() != service_uid || geteuid() != service_uid || getgid() != service_gid || getegid() != service_gid) {
    CFRelease(custom);
    fail("could not drop to the isolated broker identity");
  }

  /*
   * @napi-rs/keyring's current macOS backend accepts the four Security
   * preference domains rather than an arbitrary Keychain path. Make this
   * private Keychain the service identity's complete User-domain view before
   * exec, then let the unprivileged runtime use the normal User domain. The
   * root-only unlock master never enters the runtime environment.
   */
  const void *keychain_values[] = {custom};
  CFArrayRef search_list = CFArrayCreate(
    kCFAllocatorDefault,
    keychain_values,
    1,
    &kCFTypeArrayCallBacks
  );
  if (search_list == NULL) {
    CFRelease(custom);
    fail("could not allocate the isolated Keychain search list");
  }
  status = SecKeychainSetPreferenceDomain(kSecPreferencesDomainUser);
  if (status == errSecSuccess) {
    status = SecKeychainSetDomainDefault(kSecPreferencesDomainUser, custom);
  }
  if (status == errSecSuccess) {
    status = SecKeychainSetDomainSearchList(kSecPreferencesDomainUser, search_list);
  }
  if (status != errSecSuccess) {
    CFRelease(search_list);
    CFRelease(custom);
    fail_status("could not publish the isolated service Keychain domain", status);
  }
  SecKeychainRef domain_default = NULL;
  CFArrayRef domain_search_list = NULL;
  status = SecKeychainCopyDomainDefault(kSecPreferencesDomainUser, &domain_default);
  if (status == errSecSuccess) {
    status = SecKeychainCopyDomainSearchList(kSecPreferencesDomainUser, &domain_search_list);
  }
  if (status != errSecSuccess) {
    if (domain_search_list != NULL) CFRelease(domain_search_list);
    if (domain_default != NULL) CFRelease(domain_default);
    CFRelease(search_list);
    CFRelease(custom);
    fail_status("could not read back the isolated service Keychain domain", status);
  }
  if (domain_default == NULL || domain_search_list == NULL
      || CFGetTypeID(domain_search_list) != CFArrayGetTypeID()) {
    if (domain_search_list != NULL) CFRelease(domain_search_list);
    if (domain_default != NULL) CFRelease(domain_default);
    CFRelease(search_list);
    CFRelease(custom);
    fail("isolated service Keychain domain returned an invalid object");
  }
  CFIndex domain_search_count = CFArrayGetCount(domain_search_list);
  if (domain_search_count != 1) {
    CFRelease(domain_search_list);
    CFRelease(domain_default);
    CFRelease(search_list);
    CFRelease(custom);
    fail("isolated service Keychain search list is not exclusive");
  }
  const void *domain_search_entry = CFArrayGetValueAtIndex(domain_search_list, 0);
  bool exact_default = keychain_has_exact_path(domain_default, keychain_path);
  bool exact_search_entry = domain_search_entry != NULL
    && keychain_has_exact_path((SecKeychainRef)domain_search_entry, keychain_path);
  if (domain_search_list != NULL) CFRelease(domain_search_list);
  if (domain_default != NULL) CFRelease(domain_default);
  CFRelease(search_list);
  CFRelease(custom);
  if (!exact_default) fail("isolated service Keychain default path verification failed");
  if (!exact_search_entry) fail("isolated service Keychain search path verification failed");

  char *clean_environment[] = {
    environment_assignment("HOME", state_root),
    environment_assignment("HAPPYHERD_KEYRING_PATH", keychain_path),
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
 * Destruction is retryable across the only non-atomic boundary: the custom
 * Keychain is deleted before its root-only unlock master. A later invocation
 * accepts an already-absent Keychain, then removes the remaining master.
 */
static void destroy_keychain(
  uid_t service_uid,
  gid_t service_gid,
  const char *keychain_path,
  const char *master_owner_dir,
  const char *master_path
) {
  bool master_exists = path_exists(master_path);
  bool keychain_exists = path_exists(keychain_path);
  if (!master_exists) {
    if (keychain_exists) fail("service Keychain exists without its protected unlock master");
    if (path_exists(master_owner_dir)) {
      require_exact_directory(master_owner_dir, 0, 0, 0700, "Keychain master owner directory is unsafe");
      if (rmdir(master_owner_dir) != 0) fail("empty Keychain master owner directory could not be removed");
    }
    return;
  }

  require_exact_directory(SECRET_ROOT, 0, 0, 0700, "Keychain master root is unsafe");
  require_exact_directory(master_owner_dir, 0, 0, 0700, "Keychain master owner directory is unsafe");
  if (keychain_exists) {
    require_exact_regular(keychain_path, service_uid, service_gid, 0600, -1, "service Keychain file is unsafe");
  }
  uint8_t master[MASTER_LENGTH] = {0};
  read_master(master_path, master);
  if (keychain_exists) {
    SecKeychainRef custom = NULL;
    OSStatus status = SecKeychainOpen(keychain_path, &custom);
    if (status == errSecSuccess) status = SecKeychainUnlock(custom, MASTER_LENGTH, master, true);
    if (status == errSecSuccess) status = SecKeychainDelete(custom);
    if (custom != NULL) CFRelease(custom);
    lock_memory(master, MASTER_LENGTH);
    if (status != errSecSuccess) fail_status("could not delete the service Keychain; its unlock master was preserved", status);
    if (path_exists(keychain_path)) fail("service Keychain deletion was not durable; its unlock master was preserved");
  } else {
    lock_memory(master, MASTER_LENGTH);
  }

  if (unlink(master_path) != 0 || path_exists(master_path)) fail("could not delete the Keychain unlock master");
  if (rmdir(master_owner_dir) != 0) fail("Keychain master owner directory was not empty after deletion");
  if (rmdir(SECRET_ROOT) != 0 && errno != ENOTEMPTY) fail("Keychain master root could not be cleaned up");
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

  OSStatus interaction_status = SecKeychainSetUserInteractionAllowed(false);
  if (interaction_status != errSecSuccess) fail_status("could not disable Keychain user interaction", interaction_status);

  char expected_state[PATH_MAX];
  char expected_keychain[PATH_MAX];
  char expected_master_owner[PATH_MAX];
  char expected_master[PATH_MAX];
  exact_path(expected_state, sizeof(expected_state), "/Library/Application Support/HappyHerd/Broker/%lu", owner_uid);
  int keychain_length = snprintf(expected_keychain, sizeof(expected_keychain), "%s/Library/Keychains/happyherd.keychain-db", expected_state);
  exact_path(expected_master_owner, sizeof(expected_master_owner), SECRET_ROOT "/%lu", owner_uid);
  int master_length = snprintf(expected_master, sizeof(expected_master), "%s/keychain-master", expected_master_owner);
  if (keychain_length < 1 || (size_t)keychain_length >= sizeof(expected_keychain)
      || master_length < 1 || (size_t)master_length >= sizeof(expected_master)) {
    fail("service Keychain path is too long");
  }
  require_exact_path(argv[5], expected_state, "state root does not match the target owner");
  require_exact_path(argv[6], expected_keychain, "service Keychain path does not match the target owner");

  if (strcmp(argv[1], "--initialize") == 0 && argc == 7) {
    require_exact_directory(expected_state, service_uid, service_gid, 0710, "broker state root is unsafe");
    initialize_keychain(service_uid, service_gid, expected_state, expected_keychain, expected_master_owner, expected_master);
    return 0;
  }
  if (strcmp(argv[1], "--destroy") == 0 && argc == 7) {
    destroy_keychain(service_uid, service_gid, expected_keychain, expected_master_owner, expected_master);
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
    run_broker(
      service_uid,
      service_gid,
      expected_state,
      expected_keychain,
      expected_master_owner,
      expected_master,
      argv[7],
      argv[8],
      argv[9]
    );
  }
  fail("unsupported native Keychain broker operation");
  return 1;
}
