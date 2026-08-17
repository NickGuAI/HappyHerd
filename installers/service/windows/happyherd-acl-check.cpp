#define UNICODE
#define _UNICODE
#include <windows.h>
#include <aclapi.h>
#include <sddl.h>
#include <cstdio>
#include <string>
#include <vector>

static int fail(const wchar_t* message) {
  fwprintf(stderr, L"happyherd ACL verifier: %ls\n", message);
  return 126;
}

static bool same_sid(PSID left, PSID right) {
  return left && right && IsValidSid(left) && IsValidSid(right) && EqualSid(left, right);
}

static int verify_path(
  const std::wstring& path,
  bool directory,
  PSID system_sid,
  PSID admin_sid,
  PSID allowed_writer,
  PSID exclusive_reader
) {
  DWORD flags = FILE_FLAG_OPEN_REPARSE_POINT | (directory ? FILE_FLAG_BACKUP_SEMANTICS : 0);
  HANDLE handle = CreateFileW(path.c_str(), READ_CONTROL | FILE_READ_ATTRIBUTES, FILE_SHARE_READ,
    nullptr, OPEN_EXISTING, flags, nullptr);
  if (handle == INVALID_HANDLE_VALUE) return fail(L"protected path could not be opened");
  FILE_ATTRIBUTE_TAG_INFO tag{};
  if (!GetFileInformationByHandleEx(handle, FileAttributeTagInfo, &tag, sizeof(tag))) {
    CloseHandle(handle); return fail(L"protected path attributes could not be read");
  }
  if ((tag.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)
      || directory != !!(tag.FileAttributes & FILE_ATTRIBUTE_DIRECTORY)) {
    CloseHandle(handle); return fail(L"protected path is a reparse point or has the wrong type");
  }
  PSID owner = nullptr;
  PACL dacl = nullptr;
  PSECURITY_DESCRIPTOR descriptor = nullptr;
  DWORD status = GetSecurityInfo(handle, SE_FILE_OBJECT,
    OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
    &owner, nullptr, &dacl, nullptr, &descriptor);
  CloseHandle(handle);
  if (status != ERROR_SUCCESS || !descriptor || !same_sid(owner, system_sid)) {
    if (descriptor) LocalFree(descriptor);
    return fail(L"protected path is not owned by LocalSystem");
  }
  SECURITY_DESCRIPTOR_CONTROL control{};
  DWORD revision = 0;
  if (!GetSecurityDescriptorControl(descriptor, &control, &revision)
      || !(control & SE_DACL_PROTECTED) || !dacl) {
    LocalFree(descriptor); return fail(L"protected path DACL is inherited or absent");
  }
  const DWORD mutating = DELETE | WRITE_DAC | WRITE_OWNER | GENERIC_ALL | GENERIC_WRITE
    | FILE_WRITE_DATA | FILE_APPEND_DATA | FILE_WRITE_EA | FILE_WRITE_ATTRIBUTES | FILE_DELETE_CHILD;
  unsigned exclusive_seen = 0;
  for (DWORD index = 0; index < dacl->AceCount; index++) {
    void* raw = nullptr;
    if (!GetAce(dacl, index, &raw) || !raw) {
      LocalFree(descriptor); return fail(L"protected path DACL could not be enumerated");
    }
    auto* header = static_cast<ACE_HEADER*>(raw);
    if (header->AceFlags & INHERITED_ACE) {
      LocalFree(descriptor); return fail(L"protected path has an inherited ACE");
    }
    if (header->AceType == ACCESS_ALLOWED_ACE_TYPE) {
      auto* ace = static_cast<ACCESS_ALLOWED_ACE*>(raw);
      PSID sid = &ace->SidStart;
      if (exclusive_reader) {
        unsigned identity = same_sid(sid, system_sid) ? 1u : same_sid(sid, admin_sid) ? 2u : same_sid(sid, exclusive_reader) ? 4u : 0u;
        if (!identity || (exclusive_seen & identity)) {
          LocalFree(descriptor); return fail(L"client capability DACL contains an unexpected or duplicate reader");
        }
        const DWORD required_read = FILE_READ_DATA | FILE_READ_ATTRIBUTES | READ_CONTROL;
        if ((ace->Mask & required_read) != required_read) {
          LocalFree(descriptor); return fail(L"client capability trusted reader access is incomplete");
        }
        if (identity == 4u) {
          if (ace->Mask & mutating) {
            LocalFree(descriptor); return fail(L"client capability owner access is not read-only");
          }
        }
        exclusive_seen |= identity;
        continue;
      }
      if ((ace->Mask & mutating) && !same_sid(sid, system_sid) && !same_sid(sid, admin_sid) && !same_sid(sid, allowed_writer)) {
        LocalFree(descriptor); return fail(L"an untrusted identity can mutate the protected path");
      }
    } else if (exclusive_reader || header->AceType != ACCESS_DENIED_ACE_TYPE) {
      LocalFree(descriptor); return fail(L"protected path DACL contains an unsupported ACE type");
    }
  }
  if (exclusive_reader && exclusive_seen != 7u) {
    LocalFree(descriptor); return fail(L"client capability DACL is missing an exact trusted reader");
  }
  LocalFree(descriptor);
  return 0;
}

int wmain(int argc, wchar_t** argv) {
  if (argc < 3) return fail(L"arguments must be protected path declarations");
  PSID system_sid = nullptr;
  PSID admin_sid = nullptr;
  if (!ConvertStringSidToSidW(L"S-1-5-18", &system_sid)
      || !ConvertStringSidToSidW(L"S-1-5-32-544", &admin_sid)) {
    if (system_sid) LocalFree(system_sid);
    if (admin_sid) LocalFree(admin_sid);
    return fail(L"trusted Windows SIDs could not be created");
  }
  int result = 0;
  for (int index = 1; index < argc;) {
    std::wstring kind = argv[index];
    if (kind == L"--file" || kind == L"--directory") {
      if (index + 1 >= argc) { result = fail(L"protected path argument is incomplete"); break; }
      result = verify_path(argv[index + 1], kind == L"--directory", system_sid, admin_sid, nullptr, nullptr);
      index += 2;
    } else if (kind == L"--directory-writer") {
      if (index + 2 >= argc) { result = fail(L"writer path argument is incomplete"); break; }
      PSID allowed = nullptr;
      if (!ConvertStringSidToSidW(argv[index + 2], &allowed)) { result = fail(L"allowed writer SID is invalid"); break; }
      result = verify_path(argv[index + 1], true, system_sid, admin_sid, allowed, nullptr);
      LocalFree(allowed);
      index += 3;
    } else if (kind == L"--client-file") {
      if (index + 2 >= argc) { result = fail(L"client capability path argument is incomplete"); break; }
      PSID owner = nullptr;
      if (!ConvertStringSidToSidW(argv[index + 2], &owner)) { result = fail(L"client capability owner SID is invalid"); break; }
      result = verify_path(argv[index + 1], false, system_sid, admin_sid, nullptr, owner);
      LocalFree(owner);
      index += 3;
    } else { result = fail(L"unsupported argument"); break; }
    if (result) break;
  }
  LocalFree(system_sid);
  LocalFree(admin_sid);
  return result;
}
