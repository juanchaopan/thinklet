/* ============================================================
   Next scene (stage theme). A round button with a chevron pointing on;
   it glows violet with a breathing ring when a scene has ended and waits
   for the child, and it is not there when nothing comes after.
   Interface: forward. Commands: forward.set {enabled, ready, shown}.
   Events: forward.press.
   ============================================================ */
StageTheme.button('scene-next', { iface: 'forward', icon: 'next', label: '下一幕' });
