#define UNICODE
#define _UNICODE
#include <windows.h>
#include <algorithm>
#include <string>
#include <vector>

static SERVICE_STATUS_HANDLE status_handle = nullptr;
static SERVICE_STATUS service_status{};
static HANDLE child_process = nullptr;
static HANDLE child_job = nullptr;
static std::wstring service_name;
static std::wstring node_path;
static std::wstring script_path;
static std::wstring config_path;
static std::wstring log_path;

static std::wstring quote(const std::wstring& value) {
  std::wstring output = L"\"";
  unsigned backslashes = 0;
  for (wchar_t character : value) {
    if (character == L'\\') {
      backslashes += 1;
    } else if (character == L'\"') {
      output.append(backslashes * 2 + 1, L'\\');
      output.push_back(character);
      backslashes = 0;
    } else {
      output.append(backslashes, L'\\');
      backslashes = 0;
      output.push_back(character);
    }
  }
  output.append(backslashes * 2, L'\\');
  output.push_back(L'\"');
  return output;
}

static void report(DWORD state, DWORD error = NO_ERROR, DWORD wait_hint = 0) {
  service_status.dwServiceType = SERVICE_WIN32_OWN_PROCESS;
  service_status.dwCurrentState = state;
  service_status.dwWin32ExitCode = error;
  service_status.dwWaitHint = wait_hint;
  service_status.dwControlsAccepted = state == SERVICE_RUNNING ? SERVICE_ACCEPT_STOP | SERVICE_ACCEPT_SHUTDOWN : 0;
  SetServiceStatus(status_handle, &service_status);
}

static DWORD WINAPI control_handler(DWORD control, DWORD, void*, void*) {
  if (control == SERVICE_CONTROL_STOP || control == SERVICE_CONTROL_SHUTDOWN) {
    report(SERVICE_STOP_PENDING, NO_ERROR, 10000);
    if (child_job) TerminateJobObject(child_job, 0);
  }
  return NO_ERROR;
}

static std::vector<wchar_t> minimal_environment() {
  wchar_t windows_directory[MAX_PATH + 1]{};
  GetWindowsDirectoryW(windows_directory, MAX_PATH);
  std::wstring system_root = L"SystemRoot=" + std::wstring(windows_directory);
  std::wstring path = L"Path=" + std::wstring(windows_directory) + L"\\System32";
  std::wstring identity = L"HAPPYHERD_BROKER_SERVICE_IDENTITY=nt-service:" + service_name;
  std::wstring native_installation = L"HAPPYHERD_NATIVE_INSTALLATION=1";
  std::vector<std::wstring> values = {system_root, path, identity, native_installation};
  std::sort(values.begin(), values.end(), [](const auto& left, const auto& right) {
    return _wcsicmp(left.c_str(), right.c_str()) < 0;
  });
  std::vector<wchar_t> block;
  for (const auto& value : values) {
    block.insert(block.end(), value.begin(), value.end());
    block.push_back(L'\0');
  }
  block.push_back(L'\0');
  return block;
}

static void WINAPI service_main(DWORD, LPWSTR*) {
  status_handle = RegisterServiceCtrlHandlerExW(service_name.c_str(), control_handler, nullptr);
  if (!status_handle) return;
  report(SERVICE_START_PENDING, NO_ERROR, 15000);

  SECURITY_ATTRIBUTES attributes{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
  HANDLE log = CreateFileW(log_path.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE,
    &attributes, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (log == INVALID_HANDLE_VALUE) {
    report(SERVICE_STOPPED, GetLastError());
    return;
  }

  child_job = CreateJobObjectW(nullptr, nullptr);
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!child_job || !SetInformationJobObject(child_job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) {
    CloseHandle(log);
    report(SERVICE_STOPPED, GetLastError());
    return;
  }

  std::wstring command = quote(node_path) + L" " + quote(script_path) + L" broker-service --config " + quote(config_path);
  std::vector<wchar_t> mutable_command(command.begin(), command.end());
  mutable_command.push_back(L'\0');
  std::vector<wchar_t> environment = minimal_environment();
  STARTUPINFOW startup{};
  startup.cb = sizeof(startup);
  startup.dwFlags = STARTF_USESTDHANDLES;
  startup.hStdInput = INVALID_HANDLE_VALUE;
  startup.hStdOutput = log;
  startup.hStdError = log;
  PROCESS_INFORMATION process{};
  BOOL created = CreateProcessW(
    node_path.c_str(), mutable_command.data(), nullptr, nullptr, TRUE,
    CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT, environment.data(), nullptr,
    &startup, &process
  );
  CloseHandle(log);
  if (!created || !AssignProcessToJobObject(child_job, process.hProcess)
      || ResumeThread(process.hThread) == static_cast<DWORD>(-1)) {
    DWORD failure = GetLastError();
    if (created) TerminateProcess(process.hProcess, 1);
    if (created) { CloseHandle(process.hThread); CloseHandle(process.hProcess); }
    report(SERVICE_STOPPED, failure);
    return;
  }
  CloseHandle(process.hThread);
  child_process = process.hProcess;
  report(SERVICE_RUNNING);
  WaitForSingleObject(child_process, INFINITE);
  DWORD exit_code = 1;
  GetExitCodeProcess(child_process, &exit_code);
  CloseHandle(child_process);
  child_process = nullptr;
  CloseHandle(child_job);
  child_job = nullptr;
  report(SERVICE_STOPPED, exit_code == 0 ? NO_ERROR : ERROR_SERVICE_SPECIFIC_ERROR);
}

int wmain(int argc, wchar_t** argv) {
  for (int index = 1; index + 1 < argc; index += 2) {
    std::wstring name = argv[index];
    std::wstring value = argv[index + 1];
    if (name == L"--service-name") service_name = value;
    else if (name == L"--node") node_path = value;
    else if (name == L"--script") script_path = value;
    else if (name == L"--config") config_path = value;
    else if (name == L"--log") log_path = value;
    else return 2;
  }
  if (service_name.empty() || node_path.empty() || script_path.empty() || config_path.empty() || log_path.empty()) return 2;
  SERVICE_TABLE_ENTRYW table[] = {
    {const_cast<LPWSTR>(service_name.c_str()), service_main},
    {nullptr, nullptr},
  };
  if (!StartServiceCtrlDispatcherW(table)) return static_cast<int>(GetLastError());
  return 0;
}
