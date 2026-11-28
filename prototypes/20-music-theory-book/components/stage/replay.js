/* ============================================================
   Replay (stage theme). A round button with a circling arrow; it comes in
   once the lecture has been heard to the end, and pressing it plays the
   whole lecture again from the start.
   Interface: restart. Commands: restart.set {shown}. Events: restart.press.
   ============================================================ */
StageTheme.button('replay', { iface: 'restart', icon: 'replay', label: '从头再讲一遍', shown: false });
