import { splitOrderingPrefix, stripExtension } from "@courseo/shared";

/**
 * Friendly rendering of an on-disk name: file extensions hidden for
 * lessons (the type badge already says what it is) and "01-Name" ordering
 * prefixes shown as a styled number. Display-only — never affects the
 * filesystem.
 */
export function FriendlyName({
  name,
  file = false,
}: {
  name: string;
  file?: boolean;
}) {
  const { ordinal, label } = splitOrderingPrefix(
    file ? stripExtension(name) : name,
  );
  return (
    <>
      {ordinal !== null && <span className="name-ordinal">{ordinal}</span>}
      {label}
    </>
  );
}
