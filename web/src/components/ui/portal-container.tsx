import * as React from "react";

type PortalContainer = HTMLElement | ShadowRoot | null;
type PortalContainerRef = React.RefObject<PortalContainer>;

const PortalContainerContext = React.createContext<PortalContainerRef | null>(null);

export function PortalContainerProvider({
    children,
    containerRef,
}: {
    children: React.ReactNode;
    containerRef: PortalContainerRef;
}) {
    return (
        <PortalContainerContext.Provider value={containerRef}>
            {children}
        </PortalContainerContext.Provider>
    );
}

export function usePortalContainer() {
    return React.useContext(PortalContainerContext);
}
