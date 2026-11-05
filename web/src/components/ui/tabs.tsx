import { CheckIcon, EllipsisIcon } from "lucide-react";
import { Tabs as TabsPrimitive } from "radix-ui";
import * as React from "react";
import { useTranslations } from "use-intl";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// Port of Corivo's kit: tabs that do not fit fold into a "…" menu.
type TabsOverflowContextValue = { value: string | undefined; setValue: (value: string) => void };

const TabsOverflowContext = React.createContext<TabsOverflowContextValue | null>(null);

function Tabs({
    className,
    value: valueProp,
    defaultValue,
    onValueChange,
    ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
    // The root is always controlled here, so the "…" menu can pick a tab too.
    const [internalValue, setInternalValue] = React.useState(defaultValue);
    const isControlled = valueProp !== undefined;
    const value = isControlled ? valueProp : internalValue;
    const setValue = React.useCallback(
        (next: string) => {
            if (!isControlled) setInternalValue(next);
            onValueChange?.(next);
        },
        [isControlled, onValueChange],
    );
    const context = React.useMemo(() => ({ value, setValue }), [value, setValue]);
    return (
        <TabsOverflowContext.Provider value={context}>
            <TabsPrimitive.Root
                data-slot="tabs"
                value={value}
                onValueChange={setValue}
                className={cn("group/tabs flex flex-col gap-4", className)}
                {...props}
            />
        </TabsOverflowContext.Provider>
    );
}

type TriggerProps = {
    value: string;
    className?: string;
    disabled?: boolean;
    children?: React.ReactNode;
    ref?: React.Ref<HTMLElement>;
};

const MORE_BUTTON_FALLBACK_WIDTH = 34;
const SUBPIXEL_TOLERANCE = 1;

function TabsList({
    className,
    overflow = "auto",
    children,
    ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & { overflow?: "auto" | "none" }) {
    const t = useTranslations("web");
    const overflowCtx = React.useContext(TabsOverflowContext);
    const enabled = overflow === "auto" && overflowCtx !== null;

    const childArray = React.Children.toArray(children);
    const items = childArray.filter(
        (child): child is React.ReactElement<TriggerProps> =>
            React.isValidElement<TriggerProps>(child) && typeof child.props.value === "string",
    );

    const listRef = React.useRef<HTMLDivElement | null>(null);
    const moreRef = React.useRef<HTMLButtonElement | null>(null);
    const itemElsRef = React.useRef(new Map<string, HTMLElement>());
    const widthCacheRef = React.useRef(new Map<string, number>());
    // null: every tab shown, as on the first paint.
    const [visibleCount, setVisibleCount] = React.useState<number | null>(null);

    // A new set of tabs shows them all in this render, so they can be measured.
    const signature = items.map((item) => item.props.value).join("|");
    const signatureRef = React.useRef(signature);
    if (signatureRef.current !== signature) {
        signatureRef.current = signature;
        if (visibleCount !== null) setVisibleCount(null);
    }

    const itemsRef = React.useRef(items);
    itemsRef.current = items;

    const recompute = React.useCallback(() => {
        const list = listRef.current;
        if (!list) return;
        const values = itemsRef.current.map((item) => item.props.value);

        // flex-1 stretches the triggers, so grow is off while measuring; a hidden trigger
        // measures 0 and keeps its last width.
        const measurable: { el: HTMLElement; prevFlex: string }[] = [];
        for (const el of itemElsRef.current.values()) {
            if (el.offsetWidth > 0) {
                measurable.push({ el, prevFlex: el.style.flex });
                el.style.flex = "0 0 auto";
            }
        }
        for (const [value, el] of itemElsRef.current) {
            if (el.offsetWidth > 0)
                widthCacheRef.current.set(value, el.getBoundingClientRect().width);
        }
        for (const { el, prevFlex } of measurable) el.style.flex = prevFlex;

        // The list is w-fit, so its own width would feed back into the limit; width:100% for a
        // moment gives the room actually available.
        const prevWidth = list.style.width;
        list.style.width = "100%";
        const fullWidth = list.getBoundingClientRect().width + SUBPIXEL_TOLERANCE;
        list.style.width = prevWidth;

        const styles = getComputedStyle(list);
        const available =
            fullWidth -
            (Number.parseFloat(styles.paddingLeft) || 0) -
            (Number.parseFloat(styles.paddingRight) || 0);
        const gap = Number.parseFloat(styles.columnGap) || 0;
        const widths = values.map((value) => widthCacheRef.current.get(value) ?? 0);
        const totalAll =
            widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(values.length - 1, 0);

        let next: number | null = null;
        if (totalAll > available) {
            let used = (moreRef.current?.offsetWidth || MORE_BUTTON_FALLBACK_WIDTH) + gap;
            let count = 0;
            for (const width of widths) {
                const needed = width + (count > 0 ? gap : 0);
                if (used + needed > available) break;
                used += needed;
                count += 1;
            }
            next = Math.max(count, 1);
        }
        setVisibleCount((prev) => (prev === next ? prev : next));
    }, []);

    // biome-ignore lint/correctness/useExhaustiveDependencies: a new set of tabs is measured again
    React.useLayoutEffect(() => {
        if (!enabled) return;
        recompute();
        const list = listRef.current;
        if (!list) return;
        const observer = new ResizeObserver(() => recompute());
        observer.observe(list);
        // A folded w-fit list does not grow with its parent, so the parent is watched too.
        if (list.parentElement) observer.observe(list.parentElement);
        return () => observer.disconnect();
    }, [enabled, signature, recompute]);

    const hiddenFrom = enabled && visibleCount !== null ? visibleCount : items.length;
    let managedIndex = -1;
    const renderedChildren = enabled
        ? childArray.map((child) => {
              if (
                  !React.isValidElement<TriggerProps>(child) ||
                  typeof child.props.value !== "string"
              )
                  return child;
              managedIndex += 1;
              const value = child.props.value;
              const overflowed = managedIndex >= hiddenFrom;
              return React.cloneElement(child, {
                  className: cn(child.props.className, overflowed && "hidden"),
                  disabled: overflowed ? true : child.props.disabled,
                  ref: (node: HTMLElement | null) => {
                      if (node) itemElsRef.current.set(value, node);
                      else itemElsRef.current.delete(value);
                  },
              });
          })
        : children;

    const overflowedItems = items.slice(hiddenFrom);
    const activeOverflowed = overflowedItems.some(
        (item) => item.props.value === overflowCtx?.value,
    );

    return (
        <TabsPrimitive.List
            ref={listRef}
            data-slot="tabs-list"
            className={cn(
                "inline-flex h-9 w-fit max-w-full items-center justify-start overflow-x-auto rounded-2xl bg-muted p-0.75 text-muted-foreground no-scrollbar",
                className,
            )}
            {...props}
        >
            {renderedChildren}
            {overflowedItems.length > 0 && overflowCtx !== null && (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            ref={moreRef}
                            type="button"
                            data-active={activeOverflowed ? "" : undefined}
                            aria-label={t("common.moreTabs")}
                            className="ml-auto inline-flex h-[calc(100%-1px)] shrink-0 cursor-pointer items-center justify-center rounded-full border border-transparent px-1.5 py-1 text-sm font-medium text-foreground/60 transition-all not-data-active:hover:bg-primary/10 not-data-active:hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:not-data-active:text-muted-foreground data-active:bg-primary data-active:text-primary-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
                        >
                            <EllipsisIcon />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        align="end"
                        className="w-max min-w-48 max-w-[min(20rem,calc(100vw-2rem))]"
                    >
                        {overflowedItems.map((item) => (
                            <DropdownMenuItem
                                key={item.props.value}
                                disabled={item.props.disabled}
                                onSelect={() => overflowCtx.setValue(item.props.value)}
                                className="items-start"
                            >
                                {/* Without min-w-0 a badge pushes out of the menu. */}
                                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1 [&_svg]:shrink-0">
                                    {item.props.children}
                                </span>
                                {overflowCtx.value === item.props.value && (
                                    <CheckIcon className="mt-0.5 ml-auto shrink-0" />
                                )}
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
        </TabsPrimitive.List>
    );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
    return (
        <TabsPrimitive.Trigger
            data-slot="tabs-trigger"
            className={cn(
                "inline-flex h-[calc(100%-1px)] flex-1 cursor-pointer items-center justify-center gap-2 rounded-full border border-transparent px-3 py-1 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all not-data-[state=active]:hover:bg-primary/10 not-data-[state=active]:hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 dark:not-data-[state=active]:text-muted-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
                "[&_[data-slot=badge]]:bg-primary/15 [&_[data-slot=badge]]:text-primary data-[state=active]:[&_[data-slot=badge]]:bg-primary-foreground",
                className,
            )}
            {...props}
        />
    );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
    return (
        <TabsPrimitive.Content
            data-slot="tabs-content"
            className={cn("flex-1 text-sm outline-none", className)}
            {...props}
        />
    );
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
