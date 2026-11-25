/**
 * The query parameter, and its value, with which the product home opens
 * after the parent deleted their account (rules.md, 删除账号): 你的账号已删除
 * covers the page.
 */
export const ACCOUNT_DELETED_PARAMETER = 'account';
export const ACCOUNT_DELETED_VALUE = 'deleted';

/**
 * Where the browser goes, with a full page load, once the account is
 * deleted: the product home with the dialog over it. The full load leaves
 * nothing of the signed-in parent in the app.
 */
export const ACCOUNT_DELETED_URL = `/?${ACCOUNT_DELETED_PARAMETER}=${ACCOUNT_DELETED_VALUE}`;
