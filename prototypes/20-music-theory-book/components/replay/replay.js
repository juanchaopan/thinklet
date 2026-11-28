/* ============================================================
   Replay. A round glass button with a circling arrow (stage-glass); it
   comes in once the lecture has been heard to the end, and pressing it
   plays the whole lecture again from the start.
   Interface: restart. Commands: restart.set {shown}. Events: restart.press.
   ============================================================ */
StageGlass.button('replay', { iface: 'restart', icon: 'replay', label: '从头再讲一遍', shown: false });
