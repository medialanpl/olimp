import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function CopyButton({ value, label }: { value: string; label: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
                void navigator.clipboard.writeText(value).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                })
            }
        >
            {copied ? <CheckIcon /> : <CopyIcon />}
            {label}
        </Button>
    );
}
