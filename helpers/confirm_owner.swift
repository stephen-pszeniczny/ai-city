// Asks the Mac owner to confirm with Touch ID, or the Mac password as the backup.
//
// Used by the Asteroid Belt backend before switching from Sample to Personal
// mode (src/aicity/mode.py). The prompt is macOS's own, so a web page can't
// fake or skip it. Takes no arguments and prints nothing.
//
// Exit codes:  0 confirmed   1 not confirmed (cancelled or failed)
//              2 can't ask (no Touch ID and no password available)
//
// Compile with:  .venv/bin/python scripts/build_touch_id_helper.py

import Foundation
import LocalAuthentication

// What the prompt says depends on the one argument: mode (default), vault or jobs.
let reasons = [
    "mode": "switch the Asteroid Belt to Personal mode (real data)",
    "vault": "open the Vault in the Asteroid Belt",
    "jobs": "open Opportunity Office in the Asteroid Belt",
]
let operation = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "mode"
guard let reason = reasons[operation] else { exit(1) }

let context = LAContext()
var problem: NSError?

// .deviceOwnerAuthentication = Touch ID, falling back to the Mac password.
guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &problem) else {
    exit(2)
}

context.evaluatePolicy(
    .deviceOwnerAuthentication,
    localizedReason: reason
) { success, _ in
    exit(success ? 0 : 1)
}

// Keep running until the answer arrives; the callback above exits.
dispatchMain()
