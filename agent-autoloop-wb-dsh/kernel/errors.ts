// 内核抛出的错误：HTTP 门面根据类型决定状态码。它们都带一句话的中文说明，直接给调用者看。
export class InputError extends Error {}
export class AuthError extends Error {}
export class Conflict extends Error {}
export class NotFound extends Error {}
