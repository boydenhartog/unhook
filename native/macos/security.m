// No PID-based trust: bind the signature check to the kernel-issued audit token.
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#include <sys/socket.h>
#include <sys/acl.h>
#include <errno.h>
#include <sys/un.h>
#include <unistd.h>

static NSDictionary *signingInfo(SecCodeRef code) {
    CFDictionaryRef raw = NULL;
    if (SecCodeCopySigningInformation(code, kSecCSSigningInformation, &raw) != errSecSuccess) return nil;
    return CFBridgingRelease(raw);
}

static BOOL hardened(NSDictionary *info) {
    NSNumber *flags = info[(__bridge NSString *)kSecCodeInfoFlags];
    NSDictionary *entitlements = info[(__bridge NSString *)kSecCodeInfoEntitlementsDict];
    return (flags.unsignedIntValue & 0x10000) != 0 &&
           ![entitlements[@"com.apple.security.get-task-allow"] boolValue] &&
           ![entitlements[@"com.apple.security.cs.disable-library-validation"] boolValue] &&
           ![entitlements[@"com.apple.security.cs.allow-dyld-environment-variables"] boolValue];
}

static NSString *selfTeam(void) {
    SecCodeRef code = NULL;
    if (SecCodeCopySelf(kSecCSDefaultFlags, &code) != errSecSuccess) return nil;
    NSDictionary *info = signingInfo(code);
    NSString *team = info[(__bridge NSString *)kSecCodeInfoTeamIdentifier];
    BOOL valid = hardened(info) && SecCodeCheckValidity(code, kSecCSStrictValidate, NULL) == errSecSuccess;
    CFRelease(code);
    // Team IDs originate in the certificate; validate before building a requirement.
    NSCharacterSet *allowed = [NSCharacterSet characterSetWithCharactersInString:@"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"];
    if (!valid || team.length != 10 || [team rangeOfCharacterFromSet:allowed.invertedSet].location != NSNotFound) return nil;
    return team;
}

static SecRequirementRef requirement(NSString *team, NSString *identifier) {
    NSString *text = [NSString stringWithFormat:@"anchor apple generic and identifier \"%@\" and certificate leaf[subject.OU] = \"%@\"", identifier, team];
    SecRequirementRef result = NULL;
    if (SecRequirementCreateWithString((__bridge CFStringRef)text, kSecCSDefaultFlags, &result) != errSecSuccess) return NULL;
    return result;
}

int unhook_signed_bundle_supported(void) {
    @autoreleasepool {
        NSString *team = selfTeam();
        if (!team || ![[NSBundle mainBundle].bundleIdentifier isEqualToString:@"org.unhook.desktop"]) return 0;
        NSString *path = [[NSBundle mainBundle].bundlePath stringByAppendingPathComponent:@"Contents/MacOS/unhook-system-helper"];
        SecStaticCodeRef code = NULL;
        SecRequirementRef expected = requirement(team, @"org.unhook.system-helper");
        if (!expected) return 0;
        BOOL valid = SecStaticCodeCreateWithPath((__bridge CFURLRef)[NSURL fileURLWithPath:path], kSecCSDefaultFlags, &code) == errSecSuccess;
        if (valid) valid = SecStaticCodeCheckValidity(code, kSecCSStrictValidate | kSecCSCheckAllArchitectures, expected) == errSecSuccess && hardened(signingInfo((SecCodeRef)code));
        if (code) CFRelease(code);
        CFRelease(expected);
        return valid ? 1 : 0;
    }
}

int unhook_authenticate_peer(int socket) {
    @autoreleasepool {
        audit_token_t token = {0};
        socklen_t size = sizeof(token);
        if (getsockopt(socket, SOL_LOCAL, LOCAL_PEERTOKEN, &token, &size) != 0 || size != sizeof(token)) return 0;
        NSString *team = selfTeam();
        if (!team) return 0; // Unsigned helper never grants authority.
        NSDictionary *attributes = @{(__bridge NSString *)kSecGuestAttributeAudit: [NSData dataWithBytes:&token length:sizeof(token)]};
        SecCodeRef code = NULL;
        if (SecCodeCopyGuestWithAttributes(NULL, (__bridge CFDictionaryRef)attributes, kSecCSDefaultFlags, &code) != errSecSuccess) return 0;
        SecRequirementRef expected = requirement(team, @"org.unhook.desktop");
        BOOL valid = expected && SecCodeCheckValidity(code, kSecCSStrictValidate, expected) == errSecSuccess && hardened(signingInfo(code));
        if (expected) CFRelease(expected);
        CFRelease(code);
        return valid ? 1 : 0;
    }
}

int unhook_peer_is_root(int socket) {
    uid_t uid = (uid_t)-1;
    gid_t gid = (gid_t)-1;
    return getpeereid(socket, &uid, &gid) == 0 && uid == 0;
}

// Installer authorization is a code identity pin, not an Apple certificate pin.
// The caller supplies only hashes read from root-protected descriptors by Rust.
int unhook_authenticate_installed_peer(int socket, const char *approvedHashes) {
    @autoreleasepool {
        audit_token_t token = {0};
        socklen_t size = sizeof(token);
        if (!approvedHashes || getsockopt(socket, SOL_LOCAL, LOCAL_PEERTOKEN, &token, &size) != 0 || size != sizeof(token)) return 0;
        NSDictionary *attributes = @{(__bridge NSString *)kSecGuestAttributeAudit: [NSData dataWithBytes:&token length:sizeof(token)]};
        SecCodeRef code = NULL;
        if (SecCodeCopyGuestWithAttributes(NULL, (__bridge CFDictionaryRef)attributes, kSecCSDefaultFlags, &code) != errSecSuccess) return 0;
        NSDictionary *info = signingInfo(code);
        NSDictionary *entitlements = info[(__bridge NSString *)kSecCodeInfoEntitlementsDict];
        BOOL valid = SecCodeCheckValidity(code, kSecCSStrictValidate, NULL) == errSecSuccess && hardened(info) &&
            [info[(__bridge NSString *)kSecCodeInfoIdentifier] isEqualToString:@"org.unhook.desktop"] &&
            ![entitlements[@"com.apple.security.cs.allow-jit"] boolValue] &&
            ![entitlements[@"com.apple.security.cs.allow-unsigned-executable-memory"] boolValue] &&
            ![entitlements[@"com.apple.security.cs.disable-executable-page-protection"] boolValue];
        // Dynamic identity checks intentionally inspect only identity components.
        // Validate the complete static bundle too: sealed web assets invoke IPC.
        SecStaticCodeRef staticCode = NULL;
        valid = valid && SecCodeCopyStaticCode(code, kSecCSDefaultFlags, &staticCode) == errSecSuccess;
        if (valid) valid = SecStaticCodeCheckValidity(staticCode, kSecCSStrictValidate | kSecCSCheckAllArchitectures, NULL) == errSecSuccess;
        if (staticCode) CFRelease(staticCode);
        NSData *hash = info[(__bridge NSString *)kSecCodeInfoUnique];
        NSMutableString *hex = [NSMutableString string];
        if ([hash isKindOfClass:[NSData class]] && hash.length == 20) {
            const unsigned char *bytes = hash.bytes;
            for (NSUInteger i = 0; i < hash.length; i++) [hex appendFormat:@"%02x", bytes[i]];
        }
        NSString *pins = [NSString stringWithUTF8String:approvedHashes];
        valid = valid && hex.length == 40 && [[pins componentsSeparatedByString:@"\n"] containsObject:hex];
        CFRelease(code);
        return valid ? 1 : 0;
    }
}

// POSIX modes do not account for ACL write grants. Reject ACL-bearing trusted
// inputs entirely, including on ancestors, using the already-open descriptor.
static int noACL(acl_t acl) {
    // Darwin reports ENOENT when there is no extended ACL attribute.
    if (!acl) return errno == ENOENT ? 1 : 0;
    acl_entry_t entry = NULL;
    BOOL valid = acl_valid(acl) == 0;
    errno = 0;
    int result = acl_get_entry(acl, ACL_FIRST_ENTRY, &entry);
    int error = errno;
    acl_free(acl);
    // Darwin returns zero for an entry and -1/EINVAL for an empty valid ACL.
    return valid && result == -1 && error == EINVAL ? 1 : 0;
}

int unhook_fd_has_no_acl(int fd) {
    errno = 0;
    acl_t acl = acl_get_fd_np(fd, ACL_TYPE_EXTENDED);
    return noACL(acl);
}

// GUI status may inspect a root600 pin file without opening its contents.
// It separately checks every ancestor's ownership, type and symlink status.
int unhook_path_has_no_acl(const char *path) {
    if (!path) return 0;
    errno = 0;
    acl_t acl = acl_get_link_np(path, ACL_TYPE_EXTENDED);
    return noACL(acl);
}
