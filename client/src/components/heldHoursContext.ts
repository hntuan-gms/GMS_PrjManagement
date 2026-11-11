import { createContext, useContext } from "react";
import type { HeldHours } from "../bookingModel";

/**
 * Hours other projects hold of each person, provided once by ProjectWorkspace from the bookings it already
 * reads for the Resource lens (bookingModel.heldElsewhereByDay). A context because eight pickers across the
 * plan, board, resource and report tabs rank people with it. Empty outside a provider and while the bookings
 * are not read yet: hints then say what they said before bookings existed.
 */
export const HeldHoursContext = createContext<HeldHours | undefined>(undefined);

export function useHeldHours(): HeldHours | undefined {
  return useContext(HeldHoursContext);
}
