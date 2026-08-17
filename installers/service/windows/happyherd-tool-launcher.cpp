#define UNICODE
#define _UNICODE
#include <windows.h>
#include <aclapi.h>
#include <sddl.h>
#include <wincrypt.h>
#include <algorithm>
#include <cwctype>
#include <map>
#include <string>
#include <vector>

static void fail(const wchar_t* message) {
  fwprintf(stderr, L"happyherd tool launcher: %ls\n", message);
  ExitProcess(126);
}

static std::wstring utf8(const std::vector<unsigned char>& bytes) {
  if (bytes.empty()) return L"";
  int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, reinterpret_cast<const char*>(bytes.data()), static_cast<int>(bytes.size()), nullptr, 0);
  if (size <= 0) fail(L"launcher config is not valid UTF-8");
  std::wstring output(static_cast<size_t>(size), L'\0');
  if (!MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, reinterpret_cast<const char*>(bytes.data()), static_cast<int>(bytes.size()), output.data(), size)) fail(L"launcher config decoding failed");
  return output;
}

static std::wstring full_path(const std::wstring& input) {
  if (input.empty() || input.size() > 32000) fail(L"path is invalid");
  DWORD size = GetFullPathNameW(input.c_str(), 0, nullptr, nullptr);
  if (!size) fail(L"path could not be resolved");
  std::wstring output(size, L'\0');
  DWORD written = GetFullPathNameW(input.c_str(), size, output.data(), nullptr);
  if (!written || written >= size) fail(L"path could not be resolved");
  output.resize(written);
  return output;
}

static std::wstring final_path(const std::wstring& input, bool directory) {
  DWORD attributes = GetFileAttributesW(input.c_str());
  if (attributes == INVALID_FILE_ATTRIBUTES || (attributes & FILE_ATTRIBUTE_REPARSE_POINT)) fail(L"execution path is missing or reparse-controlled");
  if (directory != !!(attributes & FILE_ATTRIBUTE_DIRECTORY)) fail(L"execution path has the wrong type");
  HANDLE handle = CreateFileW(input.c_str(), FILE_READ_ATTRIBUTES, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
    directory ? FILE_FLAG_BACKUP_SEMANTICS : FILE_ATTRIBUTE_NORMAL, nullptr);
  if (handle == INVALID_HANDLE_VALUE) fail(L"execution path could not be opened");
  DWORD size = GetFinalPathNameByHandleW(handle, nullptr, 0, FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
  if (!size) { CloseHandle(handle); fail(L"execution path could not be canonicalized"); }
  std::wstring output(size, L'\0');
  DWORD written = GetFinalPathNameByHandleW(handle, output.data(), size, FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
  CloseHandle(handle);
  if (!written || written >= size) fail(L"execution path could not be canonicalized");
  output.resize(written);
  if (output.rfind(L"\\\\?\\", 0) == 0) output.erase(0, 4);
  return output;
}

static bool inside(const std::wstring& root, const std::wstring& candidate) {
  if (candidate.size() <= root.size() || _wcsnicmp(root.c_str(), candidate.c_str(), root.size())) return false;
  return candidate[root.size()] == L'\\';
}

static std::wstring quote(const std::wstring& value) {
  std::wstring output = L"\"";
  unsigned backslashes = 0;
  for (wchar_t character : value) {
    if (character == L'\\') backslashes += 1;
    else if (character == L'\"') { output.append(backslashes * 2 + 1, L'\\'); output.push_back(character); backslashes = 0; }
    else { output.append(backslashes, L'\\'); backslashes = 0; output.push_back(character); }
  }
  output.append(backslashes * 2, L'\\');
  output.push_back(L'\"');
  return output;
}

static std::map<std::wstring, std::wstring> load_config(const std::wstring& input) {
  std::wstring path = full_path(input);
  DWORD attributes = GetFileAttributesW(path.c_str());
  if (attributes == INVALID_FILE_ATTRIBUTES || (attributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT))) fail(L"launcher config is missing or unsafe");
  PSID owner = nullptr;
  PACL dacl = nullptr;
  PSECURITY_DESCRIPTOR descriptor = nullptr;
  DWORD security = GetNamedSecurityInfoW(path.data(), SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION, &owner, nullptr, &dacl, nullptr, &descriptor);
  if (security != ERROR_SUCCESS) fail(L"launcher config owner could not be verified");
  PSID system_sid = nullptr;
  PSID admin_sid = nullptr;
  if (!ConvertStringSidToSidW(L"S-1-5-18", &system_sid)) fail(L"LocalSystem SID could not be created");
  if (!ConvertStringSidToSidW(L"S-1-5-32-544", &admin_sid)) fail(L"Administrators SID could not be created");
  if (!EqualSid(owner, system_sid) || !dacl) fail(L"launcher config is not owned by LocalSystem");
  SECURITY_DESCRIPTOR_CONTROL control{}; DWORD revision = 0;
  if (!GetSecurityDescriptorControl(descriptor, &control, &revision) || !(control & SE_DACL_PROTECTED)) fail(L"launcher config DACL is not protected");
  const DWORD mutating = DELETE | WRITE_DAC | WRITE_OWNER | GENERIC_ALL | GENERIC_WRITE
    | FILE_WRITE_DATA | FILE_APPEND_DATA | FILE_WRITE_EA | FILE_WRITE_ATTRIBUTES | FILE_DELETE_CHILD;
  for (DWORD index = 0; index < dacl->AceCount; index++) {
    void* raw = nullptr;
    if (!GetAce(dacl, index, &raw) || !raw) fail(L"launcher config DACL could not be read");
    auto* header = static_cast<ACE_HEADER*>(raw);
    if (header->AceFlags & INHERITED_ACE) fail(L"launcher config DACL contains inherited access");
    if (header->AceType == ACCESS_ALLOWED_ACE_TYPE) {
      auto* ace = static_cast<ACCESS_ALLOWED_ACE*>(raw);
      PSID sid = &ace->SidStart;
      if ((ace->Mask & mutating) && !EqualSid(sid, system_sid) && !EqualSid(sid, admin_sid)) fail(L"launcher config is writable by an untrusted identity");
    } else if (header->AceType != ACCESS_DENIED_ACE_TYPE) fail(L"launcher config DACL contains an unsupported ACE type");
  }
  LocalFree(system_sid); LocalFree(admin_sid); LocalFree(descriptor);

  HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) fail(L"launcher config could not be opened");
  LARGE_INTEGER length{};
  if (!GetFileSizeEx(file, &length) || length.QuadPart < 1 || length.QuadPart > 65536) { CloseHandle(file); fail(L"launcher config size is invalid"); }
  std::vector<unsigned char> bytes(static_cast<size_t>(length.QuadPart));
  DWORD read = 0;
  if (!ReadFile(file, bytes.data(), static_cast<DWORD>(bytes.size()), &read, nullptr) || read != bytes.size()) { CloseHandle(file); fail(L"launcher config could not be read"); }
  CloseHandle(file);
  std::wstring text = utf8(bytes);
  std::map<std::wstring, std::wstring> values;
  size_t offset = 0;
  while (offset < text.size()) {
    size_t end = text.find(L'\n', offset);
    if (end == std::wstring::npos) fail(L"launcher config must end each line");
    std::wstring line = text.substr(offset, end - offset); offset = end + 1;
    if (!line.empty() && line.back() == L'\r') line.pop_back();
    size_t equals = line.find(L'=');
    if (!equals || equals == std::wstring::npos || equals + 1 >= line.size()) fail(L"launcher config line is invalid");
    std::wstring key = line.substr(0, equals), value = line.substr(equals + 1);
    if (!values.emplace(key, value).second) fail(L"launcher config has duplicate fields");
  }
  const wchar_t* required[] = {L"schema", L"broker_sid", L"tool_user", L"tool_sid", L"tool_password", L"bundle_root", L"python_runtime", L"node_runtime"};
  if (values.size() != 8 || values[L"schema"] != L"1") fail(L"launcher config shape is invalid");
  for (const wchar_t* key : required) if (!values.count(key)) fail(L"launcher config is incomplete");
  return values;
}

static std::wstring current_sid() {
  HANDLE token = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) fail(L"caller identity could not be opened");
  DWORD size = 0; GetTokenInformation(token, TokenUser, nullptr, 0, &size);
  std::vector<unsigned char> bytes(size);
  if (!GetTokenInformation(token, TokenUser, bytes.data(), size, &size)) { CloseHandle(token); fail(L"caller identity could not be read"); }
  CloseHandle(token);
  LPWSTR value = nullptr;
  if (!ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(bytes.data())->User.Sid, &value)) fail(L"caller SID could not be rendered");
  std::wstring output(value); LocalFree(value); return output;
}

static std::wstring account_sid(const std::wstring& account) {
  DWORD sid_size = 0, domain_size = 0;
  SID_NAME_USE use{};
  LookupAccountNameW(nullptr, account.c_str(), nullptr, &sid_size, nullptr, &domain_size, &use);
  if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || !sid_size) fail(L"isolated tool account SID could not be sized");
  std::vector<unsigned char> sid(sid_size);
  std::vector<wchar_t> domain(domain_size ? domain_size : 1);
  if (!LookupAccountNameW(nullptr, account.c_str(), sid.data(), &sid_size, domain.data(), &domain_size, &use) || !IsValidSid(sid.data())) {
    fail(L"isolated tool account SID could not be resolved");
  }
  LPWSTR value = nullptr;
  if (!ConvertSidToStringSidW(sid.data(), &value)) fail(L"isolated tool account SID could not be rendered");
  std::wstring output(value); LocalFree(value); return output;
}

static std::wstring random_object_name() {
  HCRYPTPROV provider = 0;
  unsigned char bytes[16]{};
  if (!CryptAcquireContextW(&provider, nullptr, nullptr, PROV_RSA_AES, CRYPT_VERIFYCONTEXT | CRYPT_SILENT)) {
    fail(L"private desktop name provider could not be opened");
  }
  BOOL generated = CryptGenRandom(provider, static_cast<DWORD>(sizeof(bytes)), bytes);
  CryptReleaseContext(provider, 0);
  if (!generated) fail(L"private desktop name could not be generated");
  static const wchar_t* digits = L"0123456789abcdef";
  std::wstring output = L"HappyHerd-";
  output.reserve(output.size() + sizeof(bytes) * 2);
  for (unsigned char byte : bytes) { output.push_back(digits[byte >> 4]); output.push_back(digits[byte & 0x0f]); }
  return output;
}

static PSECURITY_DESCRIPTOR private_desktop_security(const std::wstring& broker_sid, const std::wstring& tool_sid) {
  std::wstring sddl = L"D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;" + broker_sid + L")(A;;GA;;;" + tool_sid + L")";
  PSECURITY_DESCRIPTOR descriptor = nullptr;
  if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(), SDDL_REVISION_1, &descriptor, nullptr)) {
    fail(L"private desktop security descriptor could not be created");
  }
  return descriptor;
}

static std::wstring decrypt_password(const std::wstring& encoded) {
  DWORD size = 0;
  if (!CryptStringToBinaryW(encoded.c_str(), 0, CRYPT_STRING_BASE64, nullptr, &size, nullptr, nullptr)) fail(L"tool password envelope is invalid");
  std::vector<unsigned char> ciphertext(size);
  if (!CryptStringToBinaryW(encoded.c_str(), 0, CRYPT_STRING_BASE64, ciphertext.data(), &size, nullptr, nullptr)) fail(L"tool password envelope is invalid");
  DATA_BLOB input{size, ciphertext.data()}, output{};
  if (!CryptUnprotectData(&input, nullptr, nullptr, nullptr, nullptr, CRYPTPROTECT_LOCAL_MACHINE | CRYPTPROTECT_UI_FORBIDDEN, &output)) fail(L"tool password could not be unprotected");
  if (!output.cbData || output.cbData % sizeof(wchar_t)) { LocalFree(output.pbData); fail(L"tool password is invalid"); }
  std::wstring password(reinterpret_cast<wchar_t*>(output.pbData), output.cbData / sizeof(wchar_t));
  LocalFree(output.pbData);
  while (!password.empty() && password.back() == L'\0') password.pop_back();
  if (password.size() < 32 || password.size() > 256) fail(L"tool password is invalid");
  return password;
}

static std::wstring required_environment(const wchar_t* name) {
  DWORD size = GetEnvironmentVariableW(name, nullptr, 0);
  if (size < 2 || size > 4097) fail(L"required execution environment is invalid");
  std::wstring value(size, L'\0');
  DWORD written = GetEnvironmentVariableW(name, value.data(), size);
  if (!written || written >= size) fail(L"required execution environment is invalid");
  value.resize(written);
  for (wchar_t character : value) if (character < 0x20 || character == 0x7f) fail(L"required execution environment contains controls");
  return value;
}

int wmain(int argc, wchar_t** argv) {
  std::wstring config_path, runtime_name, script_input, cwd_input;
  int divider = -1;
  for (int index = 1; index < argc; index++) {
    if (!wcscmp(argv[index], L"--")) { divider = index; break; }
    if (index + 1 >= argc) fail(L"launcher arguments are incomplete");
    std::wstring name = argv[index], value = argv[++index];
    if (name == L"--config") config_path = value;
    else if (name == L"--runtime") runtime_name = value;
    else if (name == L"--script") script_input = value;
    else if (name == L"--cwd") cwd_input = value;
    else fail(L"launcher argument is not allowed");
  }
  if (divider < 0 || config_path.empty() || runtime_name.empty() || script_input.empty() || cwd_input.empty() || argc - divider - 1 > 64) fail(L"launcher arguments are invalid");
  auto config = load_config(config_path);
  if (_wcsicmp(current_sid().c_str(), config[L"broker_sid"].c_str())) fail(L"caller is not the configured broker service identity");
  if (_wcsicmp(account_sid(config[L"tool_user"]).c_str(), config[L"tool_sid"].c_str())) fail(L"isolated tool account does not match the protected configuration");

  std::wstring bundle = final_path(config[L"bundle_root"], true);
  std::wstring script = final_path(script_input, false), cwd = final_path(cwd_input, true);
  if (!inside(bundle, script) || !inside(bundle, cwd)) fail(L"tool path is outside the verified bundle root");
  std::wstring runtime;
  if (runtime_name == L"python") runtime = final_path(config[L"python_runtime"], false);
  else if (runtime_name == L"node") runtime = final_path(config[L"node_runtime"], false);
  else if (runtime_name == L"direct") runtime = script;
  else fail(L"tool runtime is not allowed");

  std::wstring token = required_environment(L"HAPPYHERD_ACCESS_TOKEN");
  std::wstring issuer = required_environment(L"HAPPYHERD_ISSUER");
  std::wstring base = required_environment(L"HAPPYHERD_API_BASE_URL");
  wchar_t windows_directory[MAX_PATH + 1]{}; GetWindowsDirectoryW(windows_directory, MAX_PATH);
  std::vector<std::wstring> environment_values = {
    L"HAPPYHERD_ACCESS_TOKEN=" + token,
    L"HAPPYHERD_API_BASE_URL=" + base,
    L"HAPPYHERD_ISSUER=" + issuer,
    L"Path=" + std::wstring(windows_directory) + L"\\System32",
    L"SystemRoot=" + std::wstring(windows_directory),
  };
  std::sort(environment_values.begin(), environment_values.end(), [](const auto& left, const auto& right) { return _wcsicmp(left.c_str(), right.c_str()) < 0; });
  std::vector<wchar_t> environment;
  for (const auto& value : environment_values) { environment.insert(environment.end(), value.begin(), value.end()); environment.push_back(L'\0'); }
  environment.push_back(L'\0');

  std::wstring command = quote(runtime);
  if (runtime_name == L"python") command += L" -I -X utf8 " + quote(script);
  else if (runtime_name == L"node") command += L" " + quote(script);
  for (int index = divider + 1; index < argc; index++) command += L" " + quote(argv[index]);
  std::vector<wchar_t> mutable_command(command.begin(), command.end()); mutable_command.push_back(L'\0');

  // CreateProcessWithLogonW otherwise inherits the broker service's window
  // station and desktop. Microsoft requires the alternate account to have
  // access to both objects; a private pair avoids granting it access to a
  // shared service or interactive desktop.
  PSECURITY_DESCRIPTOR desktop_security = private_desktop_security(config[L"broker_sid"], config[L"tool_sid"]);
  SECURITY_ATTRIBUTES desktop_attributes{sizeof(SECURITY_ATTRIBUTES), desktop_security, FALSE};
  std::wstring station_name = random_object_name();
  HWINSTA original_station = GetProcessWindowStation();
  if (!original_station) fail(L"broker window station could not be read");
  HWINSTA private_station = CreateWindowStationW(station_name.c_str(), 0, WINSTA_ALL_ACCESS, &desktop_attributes);
  if (!private_station) fail(L"private tool window station could not be created");
  if (!SetProcessWindowStation(private_station)) fail(L"private tool window station could not be selected");
  const std::wstring desktop_name = L"Default";
  HDESK private_desktop = CreateDesktopW(desktop_name.c_str(), nullptr, nullptr, 0, DESKTOP_ALL_ACCESS, &desktop_attributes);
  if (!private_desktop) fail(L"private tool desktop could not be created");
  if (!SetProcessWindowStation(original_station)) fail(L"broker window station could not be restored");
  std::wstring startup_desktop = station_name + L"\\" + desktop_name;

  HANDLE job = CreateJobObjectW(nullptr, nullptr);
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
  limits.BasicLimitInformation.ActiveProcessLimit = 1;
  if (!job || !SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) fail(L"tool process job could not be created");

  STARTUPINFOW startup{}; startup.cb = sizeof(startup); startup.dwFlags = STARTF_USESTDHANDLES; startup.lpDesktop = startup_desktop.data();
  startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE); startup.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE); startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);
  PROCESS_INFORMATION process{};
  std::wstring password = decrypt_password(config[L"tool_password"]);
  BOOL created = CreateProcessWithLogonW(config[L"tool_user"].c_str(), L".", password.c_str(), 0,
    runtime.c_str(), mutable_command.data(), CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT,
    environment.data(), cwd.c_str(), &startup, &process);
  SecureZeroMemory(password.data(), password.size() * sizeof(wchar_t));
  if (!created) { CloseHandle(job); fail(L"isolated tool process could not be created"); }
  if (!AssignProcessToJobObject(job, process.hProcess)) { TerminateProcess(process.hProcess, 126); CloseHandle(process.hThread); CloseHandle(process.hProcess); CloseHandle(job); fail(L"tool process could not enter its containment job"); }
  if (ResumeThread(process.hThread) == static_cast<DWORD>(-1)) {
    TerminateJobObject(job, 126); CloseHandle(process.hThread); CloseHandle(process.hProcess); CloseHandle(job);
    fail(L"contained tool process could not be resumed");
  }
  CloseHandle(process.hThread);
  DWORD wait = WaitForSingleObject(process.hProcess, 60000);
  if (wait != WAIT_OBJECT_0) TerminateJobObject(job, 124);
  WaitForSingleObject(process.hProcess, 5000);
  DWORD exit_code = 124; GetExitCodeProcess(process.hProcess, &exit_code);
  CloseHandle(process.hProcess); CloseHandle(job); CloseDesktop(private_desktop); CloseWindowStation(private_station); LocalFree(desktop_security);
  return static_cast<int>(exit_code);
}
