import { ChevronsUpDownIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// The ui-kit's SearchableSelect with its props, on cmdk and Radix's popover the panel already
// has instead of the kit's Base UI combobox.
export type SearchableSelectOption<Value extends string = string> = {
    value: Value;
    label: string;
    keywords?: string;
    disabled?: boolean;
};

export type SearchableSelectGroup<Value extends string = string> = {
    label: string;
    options: readonly SearchableSelectOption<Value>[];
};

type SearchableSelectProps<Value extends string = string> = {
    // One or the other.
    options?: readonly SearchableSelectOption<Value>[];
    groups?: readonly SearchableSelectGroup<Value>[];
    value?: Value;
    onValueChange?: (value: Value) => void;
    id?: string;
    placeholder?: string;
    searchPlaceholder?: string;
    emptyMessage?: string;
    disabled?: boolean;
    className?: string;
    contentClassName?: string;
    "aria-label"?: string;
    renderOption?: (option: SearchableSelectOption<Value>) => ReactNode;
    renderValue?: (option: SearchableSelectOption<Value>) => ReactNode;
};

export function SearchableSelect<Value extends string = string>({
    options,
    groups,
    value,
    onValueChange,
    id,
    placeholder,
    searchPlaceholder,
    emptyMessage,
    disabled,
    className,
    contentClassName,
    "aria-label": ariaLabel,
    renderOption,
    renderValue,
}: SearchableSelectProps<Value>) {
    const t = useTranslations("web");
    const [open, setOpen] = useState(false);
    const sections = groups ?? [{ label: "", options: options ?? [] }];
    const selected = sections.flatMap((g) => g.options).find((o) => o.value === value) ?? null;
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    id={id}
                    role="combobox"
                    aria-expanded={open}
                    aria-label={ariaLabel}
                    disabled={disabled}
                    className={cn(
                        "w-full justify-between font-normal",
                        !selected && "text-muted-foreground",
                        className,
                    )}
                >
                    <span className="flex min-w-0 items-center gap-2 truncate">
                        {selected
                            ? renderValue
                                ? renderValue(selected)
                                : selected.label
                            : placeholder}
                    </span>
                    <ChevronsUpDownIcon className="shrink-0 text-muted-foreground" />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                className={cn("w-(--radix-popover-trigger-width) min-w-64 p-0", contentClassName)}
            >
                <Command>
                    <CommandInput placeholder={searchPlaceholder} />
                    <CommandList>
                        <CommandEmpty>{emptyMessage ?? t("search.empty")}</CommandEmpty>
                        {sections.map((group) => (
                            <CommandGroup
                                key={`${group.label}:${group.options[0]?.value}`}
                                heading={group.label || undefined}
                            >
                                {group.options.map((option) => (
                                    <CommandItem
                                        key={option.value}
                                        value={option.value}
                                        keywords={[option.label, option.keywords ?? ""]}
                                        disabled={option.disabled}
                                        data-checked={option.value === value}
                                        onSelect={() => {
                                            onValueChange?.(option.value);
                                            setOpen(false);
                                        }}
                                    >
                                        {renderOption ? renderOption(option) : option.label}
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        ))}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
