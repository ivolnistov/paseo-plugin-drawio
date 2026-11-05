// Stand-in Tool Server that stops reading its stdin at once and exits a moment later,
// so writes from the launcher hit a closed pipe while the child is still alive.
import { closeSync } from "node:fs";
closeSync(0);
setTimeout(() => process.exit(0), 1500);
