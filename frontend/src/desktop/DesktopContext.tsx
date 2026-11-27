// Lets an app panel switch the computer to another app (e.g. the Daily plan's
// "Open check-in" button). Outside a computer it does nothing.
import { createContext, useContext } from "react";

export const OpenAppContext = createContext<(id: string) => void>(() => {});

export function useOpenApp(): (id: string) => void {
  return useContext(OpenAppContext);
}
