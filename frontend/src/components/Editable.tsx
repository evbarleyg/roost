import { useEffect, useState } from "react";

// A controlled-on-blur field: lets the user type freely, persists on blur/Enter.
// Re-seeds when the underlying value changes (e.g. switching selected listing).
export function Editable({
  value,
  onSave,
  type = "text",
  placeholder,
  className = "",
  multiline = false,
}: {
  value: string | number | null | undefined;
  onSave: (v: string) => void;
  type?: "text" | "number";
  placeholder?: string;
  className?: string;
  multiline?: boolean;
}) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => setV(value ?? ""), [value]);

  const commit = () => {
    if (String(v) !== String(value ?? "")) onSave(String(v));
  };

  if (multiline) {
    return (
      <textarea
        className={`input min-h-[64px] ${className}`}
        placeholder={placeholder}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
      />
    );
  }
  return (
    <input
      type={type}
      className={`input ${className}`}
      placeholder={placeholder}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}
