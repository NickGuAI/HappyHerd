import * as React from 'react';

/**
 * True while `BaseModal` presents a dialog on a phone (UI overhaul): the
 * dialog rests on the bottom edge, 8 px from the window's sides and bottom,
 * and takes the width between those margins instead of its desktop width.
 */
export const HerdPhoneDialogContext = React.createContext(false);

export function useHerdPhoneDialog(): boolean {
    return React.useContext(HerdPhoneDialogContext);
}
