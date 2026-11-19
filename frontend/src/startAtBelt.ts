// Every fresh open starts at the belt, even when the Dock app reopens a building's
// address. Imported first in main.tsx so it runs before the router reads the address.
import { startPath } from "./belt/levels";

const start = startPath(location.pathname);
if (start !== location.pathname) history.replaceState(null, "", start);
