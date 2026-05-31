Deno.test("bridge import map does not use abandoned xxhash-wasm package", async () => {
    const configText = await Deno.readTextFile(
        new URL("./deno.jsonc", import.meta.url),
    );
    const lockText = await Deno.readTextFile(
        new URL("./deno.lock", import.meta.url),
    );

    if (
        configText.includes("xxhash-wasm") || lockText.includes("xxhash-wasm")
    ) {
        throw new Error(
            "xxhash-wasm must not be present in deno.jsonc or deno.lock",
        );
    }
});
