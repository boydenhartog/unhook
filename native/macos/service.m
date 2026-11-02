#import <Foundation/Foundation.h>
#import <ServiceManagement/ServiceManagement.h>
#include <sys/stat.h>
#include <errno.h>
extern int unhook_signed_bundle_supported(void);

// Presence includes malformed files, sockets and permission failures. Rust verifies
// protected assets and authenticates the installed endpoint before reporting ready.
static BOOL installedDaemonPresent(void) {
    const char *paths[] = {
        "/Library/LaunchDaemons/org.unhook.installed-system-helper.plist",
        "/Library/PrivilegedHelperTools/org.unhook.installed-system-helper",
        "/Library/Application Support/Unhook/approved-code-hashes",
        "/var/run/org.unhook.installed-system-helper.sock"
    };
    for (unsigned i = 0; i < sizeof(paths) / sizeof(paths[0]); i++) {
        struct stat info;
        if (lstat(paths[i], &info) == 0 || errno != ENOENT) return YES;
    }
    return NO;
}

// 5 installer managed; never register an embedded manager over installed assets.
// 0 unsupported, 1 not registered, 2 approval pending, 3 ready, 4 unavailable.
int unhook_service_status(void) {
    @autoreleasepool {
        if (installedDaemonPresent()) return 5;
        if (@available(macOS 13.0, *)) {
            if (!unhook_signed_bundle_supported()) return 4;
            SMAppService *service = [SMAppService daemonServiceWithPlistName:@"org.unhook.system-helper.plist"];
            switch (service.status) {
                case SMAppServiceStatusNotRegistered: return 1;
                case SMAppServiceStatusRequiresApproval: return 2;
                case SMAppServiceStatusEnabled: return 3;
                default: return 4;
            }
        }
        return 0;
    }
}

int unhook_service_install(void) {
    @autoreleasepool {
        int status = unhook_service_status();
        if (status != 1) return status;
        if (@available(macOS 13.0, *)) {
            NSError *error = nil;
            SMAppService *service = [SMAppService daemonServiceWithPlistName:@"org.unhook.system-helper.plist"];
            if (![service registerAndReturnError:&error]) return -1;
            return unhook_service_status();
        }
        return 0;
    }
}

int unhook_service_uninstall(void) {
    @autoreleasepool {
        int status = unhook_service_status();
        if (status != 2 && status != 3) return status;
        if (@available(macOS 13.0, *)) {
            NSError *error = nil;
            SMAppService *service = [SMAppService daemonServiceWithPlistName:@"org.unhook.system-helper.plist"];
            if (![service unregisterAndReturnError:&error]) return -1;
            return unhook_service_status();
        }
        return 0;
    }
}

// Login startup is independent from the privileged daemon's approval.
// Only register the installed application, never a temporary build bundle.
static BOOL installedMainApp(void) {
    NSBundle *bundle = [NSBundle mainBundle];
    return [bundle.bundleIdentifier isEqualToString:@"org.unhook.desktop"] &&
           [bundle.bundlePath isEqualToString:@"/Applications/Unhook.app"];
}

int unhook_login_status(void) {
    @autoreleasepool {
        if (@available(macOS 13.0, *)) {
            if (!installedMainApp()) return 4;
            switch (SMAppService.mainAppService.status) {
                case SMAppServiceStatusNotRegistered: return 1;
                case SMAppServiceStatusRequiresApproval: return 2;
                case SMAppServiceStatusEnabled: return 3;
                default: return 5;
            }
        }
        return 0;
    }
}

int unhook_login_set_enabled(int enabled) {
    @autoreleasepool {
        int status = unhook_login_status();
        if (status < 1 || status > 3) return status;
        // RequiresApproval is already registered; do not register again.
        if ((enabled && (status == 2 || status == 3)) || (!enabled && status == 1)) return status;
        if (@available(macOS 13.0, *)) {
            NSError *error = nil;
            BOOL success = enabled
                ? [SMAppService.mainAppService registerAndReturnError:&error]
                : [SMAppService.mainAppService unregisterAndReturnError:&error];
            if (!success) return -1;
            return unhook_login_status();
        }
        return 0;
    }
}

int unhook_service_open_settings(void) {
    if (@available(macOS 13.0, *)) {
        [SMAppService openSystemSettingsLoginItems];
        return 1;
    }
    return 0;
}
