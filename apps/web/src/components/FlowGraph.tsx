import { useEffect, useRef } from "react";
import cytoscape, { Core, ElementDefinition } from "cytoscape";
import { CHAIN_COLORS, NODE_COLORS, short, usd } from "../lib/format";

interface Props {
  result: any;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  path?: string[] | null;
  height?: string;
  assetFilter?: string | null;
}

export default function FlowGraph({ result, selectedId, onSelect, path, height = "560px", assetFilter }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  // build / rebuild graph when the result changes
  useEffect(() => {
    if (!ref.current || !result) return;

    const nodes: ElementDefinition[] = (result.nodes || []).map((n: any) => {
      const isSeed = n.id === result.seedAddress;
      const label =
        n.label ||
        (n.type === "exchange" ? "Exchange wallet" :
         n.type === "mixer" ? "Mixer" :
         n.type === "bridge" ? "Bridge" : short(n.id, 6, 4));
      return {
        data: {
          id: n.id,
          label,
          kind: n.type,
          chain: n.chain,
          vasp: n.vaspId || "",
          isSeed,
        },
        classes: [n.type, isSeed ? "seed" : "", n.vaspId ? "vasp" : ""].filter(Boolean).join(" "),
      };
    });

    const edges: ElementDefinition[] = (result.edges || []).map((e: any, i: number) => ({
      data: {
        id: `e${i}`,
        source: e.source,
        target: e.target,
        label: `${e.asset} ${usd(e.valueUsd)}`,
        usd: e.valueUsd,
        asset: e.asset || "",
        cross: !!e.isCrossChain,
      },
      classes: e.isCrossChain ? "cross" : "flow",
    }));

    const cy = cytoscape({
      container: ref.current,
      elements: [...nodes, ...edges],
      style: [
        {
          selector: "node",
          style: {
            "background-color": (ele: any) => NODE_COLORS[ele.data("kind")] || "#38bdf8",
            label: "data(label)",
            color: "#cbd5e1",
            "font-size": 9,
            "text-valign": "bottom",
            "text-margin-y": 6,
            width: 22,
            height: 22,
            "border-width": 2,
            "border-color": (ele: any) => `${CHAIN_COLORS[ele.data("chain")] || "#475569"}88`,
          } as any,
        },
        {
          selector: "node.seed",
          style: {
            width: 34, height: 34,
            "border-width": 3,
            "border-color": "#ef4444",
            "font-size": 11,
            "font-weight": "bold",
            color: "#f87171",
            "z-index": 99,
          } as any,
        },
        {
          selector: "node.vasp",
          style: {
            width: 28, height: 28,
            "border-width": 2,
            "border-color": "#22c55e",
          } as any,
        },
        {
          selector: "edge.flow",
          style: {
            width: (ele: any) => Math.max(1, Math.min(6, Math.log10(Math.max(10, ele.data("usd")) / 10))),
            "line-color": "#334155",
            "target-arrow-color": "#475569",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            label: "data(label)",
            "font-size": 7,
            color: "#64748b",
            "text-background-color": "#0b1220",
            "text-background-opacity": 0.85,
            "text-background-padding": 2,
          } as any,
        },
        {
          selector: "edge.cross",
          style: {
            "line-style": "dashed",
            "line-color": "#f97316",
            "target-arrow-color": "#f97316",
            width: 2.5,
          } as any,
        },
        {
          selector: "node.hl, edge.hl",
          style: { "border-color": "#38bdf8", "line-color": "#38bdf8", "target-arrow-color": "#38bdf8",
                   width: 3, "z-index": 50 } as any,
        },
        {
          selector: ".dimmed",
          style: { opacity: 0.18 } as any,
        },
        {
          selector: ".hidden-asset",
          style: { display: "none" } as any,
        },
      ],
      layout: { name: "cose", animate: true, animationDuration: 500, nodeOverlap: 12,
                idealEdgeLength: 90, randomize: true } as any,
      minZoom: 0.3, maxZoom: 2.2,
    });

    cy.on("tap", "node", (evt) => onSelect(evt.target.id()));
    cy.on("tap", (evt) => { if (evt.target === cy) onSelect(null); });
    cyRef.current = cy;

    return () => { cy.destroy(); cyRef.current = null; };
  }, [result]);

  // highlight the explainable attribution path
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().removeClass("hl dimmed");
    if (path && path.length > 1) {
      const ids = new Set(path);
      cy.elements().forEach((el: any) => {
        const inPath = el.isNode()
          ? ids.has(el.id())
          : ids.has(el.source().id()) && ids.has(el.target().id());
        if (!inPath) el.addClass("dimmed");
        else el.addClass("hl");
      });
    }
  }, [path, result]);

  // selected node ring
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().removeClass("hl");
    if (selectedId) cy.getElementById(selectedId).addClass("hl");
  }, [selectedId]);

  // asset filter: hide edges whose asset doesn't match (nodes keep only if adjacent)
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().removeClass("hidden-asset");
    if (assetFilter) {
      cy.edges().forEach((e) => {
        if (e.data("asset") !== assetFilter) e.addClass("hidden-asset");
      });
      cy.nodes().forEach((n) => {
        const touched = n.connectedEdges().some((e) => e.data("asset") === assetFilter);
        if (!touched && !n.data("isSeed")) n.addClass("hidden-asset");
      });
    }
  }, [assetFilter, result]);

  return (
    <div className="relative">
      <div ref={ref} style={{ height }} className="overflow-hidden rounded-lg bg-ink-950/60" />
      <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-2 text-[10px]">
        {Object.entries(NODE_COLORS).map(([k, c]) => (
          <span key={k} className="flex items-center gap-1 rounded bg-ink-900/80 px-1.5 py-0.5 text-slate-400">
            <span className="h-2 w-2 rounded-full" style={{ background: c }} /> {k}
          </span>
        ))}
        <span className="flex items-center gap-1 rounded bg-ink-900/80 px-1.5 py-0.5 text-orange-400">
          <span className="h-0 w-3 border-t-2 border-dashed border-orange-500" /> cross-chain
        </span>
      </div>
    </div>
  );
}
