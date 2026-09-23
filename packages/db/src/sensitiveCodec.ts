/**
 * 機微データの列を読み書きするときの差し込み口（ADR-0009）。
 * クラウドに移すときは、鍵を使った列単位の暗号化の実装に差し替える。
 */
export type SensitiveCodec = {
  encode: (plain: string) => string;
  decode: (stored: string) => string;
};

/** ローカル用。ディスクの暗号化（FileVault）に任せ、列は平文のまま保存する */
export const plainCodec: SensitiveCodec = {
  encode: (plain) => plain,
  decode: (stored) => stored,
};
