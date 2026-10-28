/**
 * [FEAT-20260830-TRAYDATA] the emoji picker's data — moved VERBATIM out of
 * TicketChat.tsx (owner: tray data gets its own tidy folder, not inlined in a
 * 6,000-line page). Pure data, no imports, no logic.
 *
 * Native Unicode emoji — renders on every OS/browser (no image assets, no lib).
 * revert: inline this array back above ChatInputBox and delete composer-trays/.
 */
export const EMOJI_SET = [
  '😊','😀','😁','😂','🤣','😅','😆','😍','🥰','😘','😗','😙','🙂','🤗','🤩','😎',
  '😏','😜','🥳','😴','😌','😔','😞','🙁','😟','😢','😭','😤','😠','😡','🤔','😐',
  '👍','👎','👌','🙏','👏','🙌','💪','🤝','✌️','👋','❤️','🧡','💛','💚','💙','💜',
  '🔥','✨','⭐','🎉','🎊','💯','✅','❌','⚠️','❓','❗','💰','📌','📞','📷','🎁',
  // [FEAT-20260830-MOREEMOJI] +52 (owner 30/08) — faces, hands, everyday objects
  '😃','😄','😉','😋','😛','🤪','🥲','😇','🤭','🤫','🤤','😪','🥱','😷','🤒','🤕',
  '🥺','😳','😬','🙄','😑','😶','🫡','🤯','🥵','🥶','😱','😨','😰','🫠','🤡','👻',
  '💔','💕','💞','💘','💖','🖤','🤍','🤎','💤','💢','💦','🎶','🙈','🙉','🙊','🐶',
  '🍀','🌈','☀️','🌙',
];
