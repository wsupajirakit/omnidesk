/**
 * register — where a customer who is being asked to register is handed over.
 * ===========================================================================
 *
 * ## THE RULES THIS FOLDER LIVES BY
 *
 * Same intent as `follow-up/`, and checked by the same spec
 * (`z-test/unit/follow-up-boundaries.spec.ts`): this folder must be liftable
 * whole. Somebody should be able to copy it into another service, or delete it,
 * and find that nothing else cared.
 *
 * 1. NO IMPORT LEAVES THIS FOLDER.
 *    Not the AI module, not mongoose, not Nest, not `follow-up/`. Files here may
 *    reference each other and nothing else. The language model arrives as a
 *    plain function typed structurally, so no vendor is named anywhere.
 *
 * 2. IT NEVER NAMES THE FEATURE THAT SENDS TO IT.
 *    The words `follow-up` and `abandon` do not appear. What arrives is a hook
 *    id, a customer id and what they wrote; why they were sent is not this
 *    folder's business.
 *
 * 3. THE CUSTOMER NEVER WAITS.
 *    `handoffToRegister` is synchronous and returns immediately. Anything slow —
 *    asking a model, for instance — is fired with `void` and cannot be awaited
 *    by accident. A test forbids making it `async`.
 *
 * 4. IT TAKES A LIST, NOT A MESSAGE.
 *    `buildMemberInfo` accepts an array from day one, so the day the input
 *    becomes a slice of conversation history, only the caller changes.
 *
 * 5. WORDING IS DATA.
 *    The prompt lives in `build-member-info.prompt.ts`, imports nothing, and can
 *    be rewritten without opening the function that sends it. The JSON keys it
 *    asks for are exported, so the parser and the prompt cannot drift apart.
 *
 * 6. NEVER THROW, NEVER GUESS, NEVER LOG A CUSTOMER'S DETAILS.
 *    A model that times out, refuses, or answers in prose yields "nothing
 *    found". Logs record WHETHER something was found — never the phone number
 *    or the account itself.
 *
 * ## STATUS
 * Deliberately incomplete: what is extracted is not used yet. The shape it will
 * be received in is settled, so the day something should happen with it, it
 * happens in `register.helper.ts` and nowhere else.
 *
 * ## REMOVING IT
 * Delete this folder and the `handoffToRegister(` call in `webhook.service.ts`.
 *
 * โฟลเดอร์นี้ต้องยกไปทั้งก้อนได้ — ห้าม import ออกนอกตัวเอง.
 */
export * from './scenarios';
export * from './build-member-info.prompt';
export * from './build-member-info';
export * from './register.helper';
