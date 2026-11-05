import * as React from "react";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

const SPEED: Record<OrbState, number> = {
    idle: 0.25,
    listening: 0.6,
    thinking: 1.5,
    speaking: 0.6,
};

const VERTEX = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`;

const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform float uTime;
uniform float uLevel;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform vec3 uC4;

float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
        u.y
    );
}

float fbm(vec2 p) {
    return 0.65 * noise(p) + 0.35 * noise(mat2(1.6, 1.2, -1.2, 1.6) * p + 7.3);
}

float wave(vec2 uv) {
    float r = length(uv);
    float bend = 3.0 * fbm(uv * 1.3 + vec2(uTime * 0.2, -uTime * 0.15));
    float rings = sin(r * 8.0 - uTime * 3.5 + bend);
    return rings * (0.12 + 0.9 * uLevel) * smoothstep(0.1, 0.45, r);
}

mat2 rot(float a) {
    return mat2(cos(a), -sin(a), sin(a), cos(a));
}

void main() {
    vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / uRes.y;
    float r = length(uv);
    float px = 2.0 / uRes.y;
    float mask = 1.0 - smoothstep(1.0 - px * 1.5, 1.0, r);
    if (mask <= 0.0) {
        gl_FragColor = vec4(0.0);
        return;
    }

    float t = uTime;
    float h = wave(uv);
    vec2 dir = uv / max(r, 0.001);
    vec2 p = rot(h * 0.9 + uLevel * 0.4 * (1.0 - r)) * uv;
    p += dir * h * 0.22 + vec2(-dir.y, dir.x) * h * 0.18;

    vec2 f = p * vec2(1.1, 0.7);
    float n1 = smoothstep(0.28, 0.72, fbm(f + vec2(t * 0.07, -t * 0.05)));
    float n2 = smoothstep(0.28, 0.72, fbm(f * 1.15 + vec2(3.1, 7.4) - vec2(t * 0.05, t * 0.06)));
    vec3 col = mix(mix(uC1, uC2, n1), mix(uC3, uC4, n1), n2);

    vec2 e = vec2(0.03, 0.0);
    vec2 slope = vec2(wave(uv + e.xy) - wave(uv - e.xy), wave(uv + e.yx) - wave(uv - e.yx)) / 0.06;
    vec3 normal = normalize(vec3(-slope * 0.12, 1.0));
    vec3 light = normalize(vec3(-0.45, 0.55, 0.7));
    float spec = pow(max(dot(reflect(-light, normal), vec3(0.0, 0.0, 1.0)), 0.0), 18.0);
    col += spec * (0.2 + 0.6 * uLevel);
    col = mix(col, vec3(1.0), max(h, 0.0) * 0.12);

    col = mix(col, vec3(1.0), 0.06);
    col = mix(col, vec3(1.0), smoothstep(1.0 - px * 3.5, 1.0 - px, r) * 0.4);

    gl_FragColor = vec4(col * mask, mask);
}
`;

type Rgb = [number, number, number];

let probe: CanvasRenderingContext2D | null | undefined;

// The palette's tokens are oklch; a 2D canvas turns them into the sRGB the shader needs.
function toRgb(color: string): Rgb {
    probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (!probe) return [0.5, 0.5, 0.5];
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = color;
    probe.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0] = probe.getImageData(0, 0, 1, 1).data;
    return [r / 255, g / 255, b / 255];
}

function readPalette(el: Element): Rgb[] {
    const style = getComputedStyle(el);
    return ["--s1", "--s2", "--s3", "--s4"].map((name) =>
        toRgb(style.getPropertyValue(name).trim()),
    );
}

function compile(gl: WebGLRenderingContext): WebGLProgram | null {
    const program = gl.createProgram();
    for (const [type, source] of [
        [gl.VERTEX_SHADER, VERTEX],
        [gl.FRAGMENT_SHADER, FRAGMENT],
    ] as const) {
        const shader = gl.createShader(type);
        if (!shader) return null;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}

// Jarvis's voice orb (medialan): a shader draws the inside, state and volume change the speed and
// swirl of its colours, never its size. The palette comes from the parent's `data-palette`.
export function OrbCanvas({
    palette,
    state = "idle",
    volume,
}: {
    palette: string;
    state?: OrbState;
    volume?: () => number;
}) {
    const ref = React.useRef<HTMLCanvasElement>(null);
    const live = React.useRef({ state, volume, colors: [] as Rgb[], redraw: () => {} });
    live.current.state = state;
    live.current.volume = volume;

    React.useEffect(() => {
        const canvas = ref.current;
        const gl = canvas?.getContext("webgl", { antialias: false, premultipliedAlpha: true });
        const program = gl && compile(gl);
        if (!canvas || !gl || !program) return;
        // biome-ignore lint/correctness/useHookAtTopLevel: a WebGL method, not a React hook
        gl.useProgram(program);
        const quad = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const position = gl.getAttribLocation(program, "p");
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        const u = (name: string) => gl.getUniformLocation(program, name);
        const uRes = u("uRes");
        const uTime = u("uTime");
        const uLevel = u("uLevel");
        const uColors = [u("uC1"), u("uC2"), u("uC3"), u("uC4")];

        const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
        let shown = live.current.colors.map((c) => [...c] as Rgb);
        let time = Math.random() * 20;
        let level = 0;
        let last = performance.now();
        let frame = 0;

        const draw = (now: number) => {
            const dt = Math.min(0.1, (now - last) / 1000);
            last = now;
            const { state: current, volume: read, colors } = live.current;
            const target = reduced ? 0 : (read?.() ?? 0);
            level += (target - level) * (1 - Math.exp(-dt * (target > level ? 30 : 5)));
            time += reduced ? 0 : dt * (SPEED[current] + level * 2.4);
            const blend = reduced ? 1 : 1 - Math.exp(-dt * 6);
            shown = colors.map((c, i) => {
                const s = shown[i] ?? c;
                return [0, 1, 2].map((k) => s[k] + (c[k] - s[k]) * blend) as Rgb;
            });

            const width = Math.round(canvas.clientWidth * devicePixelRatio);
            if (canvas.width !== width) canvas.width = canvas.height = width;
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.uniform2f(uRes, canvas.width, canvas.height);
            gl.uniform1f(uTime, time);
            gl.uniform1f(uLevel, level);
            for (const [i, c] of shown.entries()) gl.uniform3fv(uColors[i] ?? null, c);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            if (!reduced) frame = requestAnimationFrame(draw);
        };

        live.current.redraw = () => {
            if (reduced) draw(performance.now());
        };
        frame = requestAnimationFrame(draw);
        return () => {
            cancelAnimationFrame(frame);
            live.current.redraw = () => {};
            // No `loseContext`: the canvas hands back the same context when mounted again (StrictMode).
            gl.deleteBuffer(quad);
            gl.deleteProgram(program);
        };
    }, []);

    // biome-ignore lint/correctness/useExhaustiveDependencies: the palette changes the parent's `data-palette`, whose style holds the colours
    React.useEffect(() => {
        const parent = ref.current?.parentElement;
        if (!parent) return;
        live.current.colors = readPalette(parent);
        live.current.redraw();
    }, [palette]);

    return <canvas ref={ref} aria-hidden className="orb-canvas" />;
}
