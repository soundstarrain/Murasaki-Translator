import { FileText, BookOpen } from "lucide-react";

export interface FileIconProps {
  type: "txt" | "epub" | "srt" | "ass" | "ssa" | string;
  className?: string;
}

export const FileIcon = ({ type, className }: FileIconProps) => {
  switch (type) {
    case "epub":
      return (
        <BookOpen className={`w-4 h-4 text-blue-400 ${className || ""}`} />
      );
    case "srt":
    case "ass":
    case "ssa":
      return (
        <FileText className={`w-4 h-4 text-amber-400 ${className || ""}`} />
      );
    default:
      return (
        <FileText
          className={`w-4 h-4 text-muted-foreground ${className || ""}`}
        />
      );
  }
};
