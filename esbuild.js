const esbuild = require("esbuild");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
    name: 'esbuild-problem-matcher',

    setup(build) {
        build.onStart(() => {
            console.log('[watch] build started');
        });
        build.onEnd((result) => {
            if (result.errors.length > 0) {
                console.error(`✘ [ERROR] Build failed with ${result.errors.length} errors`);
            } else {
                console.log('[watch] build finished');
            }
        });
    },
};

async function buildExtension() {
    const config = {
        entryPoints: ['src/extension.ts'],
        bundle: true,
        format: 'cjs',
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: 'node',
        outfile: 'dist/extension.js',
        external: ['vscode'],
        logLevel: 'silent',
        plugins: [esbuildProblemMatcherPlugin],
    };

    if (watch) {
        esbuild.context(config).then(ctx => ctx.watch());
    } else {
        await esbuild.build(config);
    }
}

async function buildWebview() {
    const config = {
        entryPoints: ['src/webview.tsx'],
        bundle: true,
        format: 'iife',
        minify: production,
        sourcemap: !production,
        platform: 'browser',
        outfile: 'dist/webview.js',
        logLevel: 'silent',
        plugins: [esbuildProblemMatcherPlugin],
        loader: {
            '.css': 'text', // Add this line to handle CSS files
        },
    };

    if (watch) {
        esbuild.context(config).then(ctx => ctx.watch());
    } else {
        await esbuild.build(config);
    }
}

async function main() {
    console.log("starting build process...");
    try {
        await Promise.all([buildExtension(), buildWebview()]);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

main();