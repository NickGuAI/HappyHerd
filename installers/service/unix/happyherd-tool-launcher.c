#define _GNU_SOURCE
#define _DARWIN_C_SOURCE
#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <limits.h>
#include <pwd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#ifdef __linux__
#include <sched.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#endif

typedef struct {
  uid_t broker_uid;
  uid_t tool_uid;
  gid_t tool_gid;
  char bundle_root[PATH_MAX];
  char python_runtime[PATH_MAX];
  char node_runtime[PATH_MAX];
} launcher_config;

static void fail(const char *message) {
  dprintf(STDERR_FILENO, "happyherd tool launcher: %s\n", message);
  _exit(126);
}

static int parse_number(const char *value, unsigned long *output) {
  char *end = NULL;
  errno = 0;
  unsigned long parsed = strtoul(value, &end, 10);
  if (errno || !value[0] || !end || *end) return 0;
  *output = parsed;
  return 1;
}

static void copy_value(char *output, size_t size, const char *value) {
  size_t length = strlen(value);
  if (!length || length >= size || strchr(value, '\n') || strchr(value, '\r')) fail("launcher config value is invalid");
  memcpy(output, value, length + 1);
}

static void load_config(const char *path, launcher_config *config) {
  struct stat status;
  if (!path || path[0] != '/' || lstat(path, &status) || !S_ISREG(status.st_mode) || S_ISLNK(status.st_mode)) {
    fail("launcher config is missing or unsafe");
  }
  if (status.st_uid != 0 || (status.st_mode & 077) != 0) fail("launcher config is not root-owned and private");
  FILE *file = fopen(path, "r");
  if (!file) fail("launcher config could not be opened");
  char line[PATH_MAX + 64];
  unsigned seen = 0;
  while (fgets(line, sizeof(line), file)) {
    size_t length = strlen(line);
    if (!length || line[length - 1] != '\n') fail("launcher config line is too long");
    line[--length] = '\0';
    char *equals = strchr(line, '=');
    if (!equals || equals == line) fail("launcher config line is invalid");
    *equals = '\0';
    const char *value = equals + 1;
    unsigned long number = 0;
    if (!strcmp(line, "schema") && !strcmp(value, "1")) seen |= 1u;
    else if (!strcmp(line, "broker_uid") && parse_number(value, &number) && number <= UINT_MAX) { config->broker_uid = (uid_t)number; seen |= 2u; }
    else if (!strcmp(line, "tool_uid") && parse_number(value, &number) && number <= UINT_MAX) { config->tool_uid = (uid_t)number; seen |= 4u; }
    else if (!strcmp(line, "tool_gid") && parse_number(value, &number) && number <= UINT_MAX) { config->tool_gid = (gid_t)number; seen |= 8u; }
    else if (!strcmp(line, "bundle_root")) { copy_value(config->bundle_root, sizeof(config->bundle_root), value); seen |= 16u; }
    else if (!strcmp(line, "python_runtime")) { copy_value(config->python_runtime, sizeof(config->python_runtime), value); seen |= 32u; }
    else if (!strcmp(line, "node_runtime")) { copy_value(config->node_runtime, sizeof(config->node_runtime), value); seen |= 64u; }
    else fail("launcher config has an unknown or invalid field");
  }
  if (ferror(file) || fclose(file)) fail("launcher config could not be read");
  if (seen != 127u || config->broker_uid == 0 || config->tool_uid == 0 || config->broker_uid == config->tool_uid) {
    fail("launcher config is incomplete or identities overlap");
  }
}

static void resolve_regular(const char *input, char output[PATH_MAX], int executable) {
  struct stat status;
  if (!input || input[0] != '/' || !realpath(input, output) || lstat(output, &status) || !S_ISREG(status.st_mode) || S_ISLNK(status.st_mode)) {
    fail("execution path is missing or unsafe");
  }
  if ((status.st_mode & 022) != 0 || (executable && (status.st_mode & 0111) == 0)) fail("execution path permissions are unsafe");
}

static void resolve_directory(const char *input, char output[PATH_MAX]) {
  struct stat status;
  if (!input || input[0] != '/' || !realpath(input, output) || lstat(output, &status) || !S_ISDIR(status.st_mode) || S_ISLNK(status.st_mode)) {
    fail("execution directory is missing or unsafe");
  }
  if ((status.st_mode & 022) != 0) fail("execution directory permissions are unsafe");
}

static int inside(const char *root, const char *candidate) {
  size_t length = strlen(root);
  return !strncmp(root, candidate, length) && candidate[length] == '/';
}

static const char *bounded_environment(const char *name) {
  const char *value = getenv(name);
  if (!value || !value[0] || strlen(value) > 4096) fail("required execution environment is invalid");
  for (const unsigned char *cursor = (const unsigned char *)value; *cursor; cursor++) {
    if (*cursor < 0x20 || *cursor == 0x7f) fail("required execution environment contains control bytes");
  }
  return value;
}

static char *environment_assignment(const char *name, const char *value) {
  size_t name_length = strlen(name), value_length = strlen(value);
  char *assignment = malloc(name_length + value_length + 2);
  if (!assignment) fail("execution environment allocation failed");
  memcpy(assignment, name, name_length);
  assignment[name_length] = '=';
  memcpy(assignment + name_length + 1, value, value_length + 1);
  return assignment;
}

#ifdef __linux__
static void restrict_process_creation(void) {
#if defined(__x86_64__)
  const unsigned expected_arch = AUDIT_ARCH_X86_64;
#elif defined(__aarch64__)
  const unsigned expected_arch = AUDIT_ARCH_AARCH64;
#else
#error Unsupported Linux architecture
#endif
  struct sock_filter filter[] = {
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, (unsigned)offsetof(struct seccomp_data, arch)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, expected_arch, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, (unsigned)offsetof(struct seccomp_data, nr)),
#ifdef SYS_clone
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_clone, 0, 5),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, (unsigned)offsetof(struct seccomp_data, args[0])),
    BPF_STMT(BPF_ALU | BPF_AND | BPF_K, CLONE_THREAD),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, CLONE_THREAD, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
#endif
#ifdef SYS_clone3
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_clone3, 0, 1), BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
#endif
#ifdef SYS_fork
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_fork, 0, 1), BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
#endif
#ifdef SYS_vfork
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_vfork, 0, 1), BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
#endif
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
  };
  struct sock_fprog program = { (unsigned short)(sizeof(filter) / sizeof(filter[0])), filter };
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) || prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program)) {
    fail("process sandbox could not be enabled");
  }
}
#endif

int main(int argc, char **argv) {
  const char *config_path = NULL, *runtime_name = NULL, *script_input = NULL, *cwd_input = NULL;
  int divider = -1;
  for (int index = 1; index < argc; index++) {
    if (!strcmp(argv[index], "--")) { divider = index; break; }
    if (index + 1 >= argc) fail("launcher arguments are incomplete");
    if (!strcmp(argv[index], "--config")) config_path = argv[++index];
    else if (!strcmp(argv[index], "--runtime")) runtime_name = argv[++index];
    else if (!strcmp(argv[index], "--script")) script_input = argv[++index];
    else if (!strcmp(argv[index], "--cwd")) cwd_input = argv[++index];
    else fail("launcher argument is not allowed");
  }
  if (divider < 0 || !config_path || !runtime_name || !script_input || !cwd_input) fail("launcher arguments are incomplete");
  if (argc - divider - 1 > 64) fail("too many tool arguments");

  launcher_config config = {0};
  load_config(config_path, &config);
  if (getuid() != config.broker_uid || geteuid() != 0) fail("caller is not the configured broker service identity");

  char bundle_root[PATH_MAX], script[PATH_MAX], cwd[PATH_MAX], runtime[PATH_MAX];
  resolve_directory(config.bundle_root, bundle_root);
  resolve_regular(script_input, script, 0);
  resolve_directory(cwd_input, cwd);
  if (!inside(bundle_root, script) || !inside(bundle_root, cwd)) fail("tool path is outside the verified bundle root");
  if (!strcmp(runtime_name, "python")) resolve_regular(config.python_runtime, runtime, 1);
  else if (!strcmp(runtime_name, "node")) resolve_regular(config.node_runtime, runtime, 1);
  else if (!strcmp(runtime_name, "direct")) resolve_regular(script, runtime, 1);
  else fail("tool runtime is not allowed");

  const char *token = bounded_environment("HAPPYHERD_ACCESS_TOKEN");
  const char *issuer = bounded_environment("HAPPYHERD_ISSUER");
  const char *base = bounded_environment("HAPPYHERD_API_BASE_URL");
  char *clean_environment[] = {
    environment_assignment("HAPPYHERD_ACCESS_TOKEN", token),
    environment_assignment("HAPPYHERD_ISSUER", issuer),
    environment_assignment("HAPPYHERD_API_BASE_URL", base),
    NULL,
  };

  gid_t groups[] = { config.tool_gid };
  if (setgroups(1, groups) || setgid(config.tool_gid) || setuid(config.tool_uid)) fail("tool identity isolation failed");
  if (getuid() != config.tool_uid || geteuid() != config.tool_uid || getgid() != config.tool_gid || getegid() != config.tool_gid) {
    fail("tool identity did not take effect");
  }
  if (chdir(cwd)) fail("verified tool working directory is inaccessible");

  char **child = calloc((size_t)(argc - divider) + 7, sizeof(char *));
  if (!child) fail("tool argument allocation failed");
  size_t cursor = 0;
  child[cursor++] = runtime;
  if (!strcmp(runtime_name, "python")) { child[cursor++] = "-I"; child[cursor++] = "-X"; child[cursor++] = "utf8"; }
  if (strcmp(runtime_name, "direct")) child[cursor++] = script;
  for (int index = divider + 1; index < argc; index++) child[cursor++] = argv[index];
  child[cursor] = NULL;

#ifdef __linux__
  restrict_process_creation();
  execve(runtime, child, clean_environment);
#else
  const char *profile = "(version 1)(allow default)(deny process-fork)";
  char **sandbox = calloc(cursor + 5, sizeof(char *));
  if (!sandbox) fail("sandbox argument allocation failed");
  sandbox[0] = "/usr/bin/sandbox-exec"; sandbox[1] = "-p"; sandbox[2] = (char *)profile; sandbox[3] = runtime;
  for (size_t index = 1; index < cursor; index++) sandbox[index + 3] = child[index];
  sandbox[cursor + 3] = NULL;
  execve(sandbox[0], sandbox, clean_environment);
#endif
  fail("verified tool runtime could not be executed");
  return 126;
}
