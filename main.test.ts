function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

Deno.test("main exits non-zero when config file is missing", async () => {
    const missingConfig =
        `/tmp/livesync-bridge-missing-${crypto.randomUUID()}.json`;
    const command = new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", "main.ts"],
        env: {
            LSB_CONFIG: missingConfig,
        },
        stdout: "piped",
        stderr: "piped",
    });

    const result = await command.output();
    const stderr = new TextDecoder().decode(result.stderr);

    assert(result.code !== 0, "expected missing config to fail startup");
    assert(
        stderr.includes("Could not load or parse configuration"),
        `expected config error in stderr, got: ${stderr}`,
    );
});
