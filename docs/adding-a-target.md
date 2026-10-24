# Adding a target

A target is one program that every model is asked to write. It has two parts:

1. a **prompt file**, sent to every model unchanged;
2. a **harness**: a build folder with the test suite, into which each generated file is copied before the tests run.

The repository ships one small example, [`specs/tip-jar/`](../specs/tip-jar/): a Solidity contract with an
interface, a reference implementation and 18 Foundry tests. Use it as a template.

```
specs/my-target/
  prompt.md              the prompt (system and user message, output file name)
  reference/MyThing.sol  a reference implementation: not sent to the models, used to check the tests
  harness/               copied to a temporary folder for every variant
    foundry.toml
    src/IMyThing.sol     files the variant needs (an interface, libraries)
    test/MyThing.t.sol   the test suite
    lib/forge-std        Foundry's test library (a git submodule)
```

## The prompt file

```
=== SYSTEM ===
You are an experienced Solidity developer. Answer with the file only, in a single fenced code block.

=== USER ===
Implement the contract described below.
...

Output file: MyThing.sol
```

- Everything between `=== SYSTEM ===` and `=== USER ===` is the system message, everything after `=== USER ===` is
  the user message. Both are stripped of surrounding blank lines. `=== USER ===` is required; the system part may be
  empty.
- A line `Output file: <name>` is required. It names the file the variant is saved as, and the default slot in the
  harness (`src/<name>`). It must be a relative path without `..`.
- The `Output file:` line stays in the user message, so the model sees the expected file name.
- The prompt's SHA-256 is stored in every request record. If you edit a prompt after requests were sent, the plan
  reports a conflict for those requests instead of mixing two prompt versions in one run folder. Start a new
  `out_dir` instead.

Ask for exactly one fenced code block. The extraction rules are strict on purpose
([`fdlab/extract.py`](../fdlab/extract.py)):

- text inside `<think>...</think>` is removed first;
- exactly one fenced block: its content is the variant, unchanged;
- no fence: the whole answer is the variant if it starts like source code (`pragma`, `import`, `contract`,
  `package`, `public class`, a comment, ...);
- two or more blocks, an unterminated fence or no code: no variant (outcome "no usable code").

The code is never edited or repaired. A fault in a variant is the model's fault, not the pipeline's.

## The harness

The harness folder is copied to a fresh temporary folder for every variant, the variant is written to the
target's `slot`, and the runner builds and tests that copy. The harness itself is never changed, so variants
cannot affect each other.

- Put everything the variant may import into the harness (interfaces, base contracts, libraries). Tell the model
  in the prompt how to import it.
- Keep build output out of the harness: `out/`, `cache/` (Foundry) and `build/`, `.gradle/` (Gradle) are not
  copied even if they exist.
- The test suite should only use the public interface, so that any correct implementation passes it.
- Check the suite against your reference implementation before any request is sent:

  ```bash
  python -m fdlab.evaluate config/my-run.json --target my-target \
      --file specs/my-target/reference/MyThing.sol --out /tmp/reference-check
  ```

  Every test must pass. A test that fails on the reference would be counted as a fault of every model.

### Foundry (`"runner": "forge"`)

The runner calls `forge build --offline`, then `forge test --offline --json`. A failed build is a compile error.
Test groups are the test contracts; test names are the test functions. If the `solc` version pinned in
`foundry.toml` is not installed yet, the runner builds once without `--offline` so that forge downloads it.

Add forge-std as a submodule pinned to a release:

```bash
git submodule add https://github.com/foundry-rs/forge-std specs/my-target/harness/lib/forge-std
git -C specs/my-target/harness/lib/forge-std checkout v1.16.1
```

Pin `solc_version` and `evm_version` in `foundry.toml`, so every variant is compiled the same way.

### Gradle and JUnit 5 (`"runner": "gradle"`)

The runner calls `./gradlew --offline --console=plain test --continue` in the harness copy (or `gradle` from
`PATH` when the harness has no wrapper) and reads the JUnit XML reports in `build/test-results/test/`. When no
report is written, the variant did not compile. Test groups are the test classes; test names are the test method
names. The whole Gradle output is saved as `build.log`, and `javac` errors in it are parsed for the dashboard.

A minimal harness that works with the runner:

```
harness/
  settings.gradle                       rootProject.name = 'my-target-harness'
  build.gradle                          see below
  gradlew, gradlew.bat, gradle/wrapper/ created with `gradle wrapper`
  src/test/java/demo/CounterTests.java  the JUnit 5 tests
```

```groovy
plugins { id 'java' }

repositories { mavenCentral() }

dependencies {
    testImplementation 'org.junit.jupiter:junit-jupiter:5.10.2'
}

java { toolchain { languageVersion = JavaLanguageVersion.of(21) } }

test {
    useJUnitPlatform()
    ignoreFailures = true  // a failing test is a result, not a build error
}
```

with `"slot": "src/main/java/demo/Counter.java"` in the target. Because the runner passes `--offline`, Gradle,
the JDK and the JUnit dependencies must already be in the local Gradle cache. Fill it once with network access:
copy the harness to a scratch folder, put the reference implementation in the slot and run `./gradlew test` there.
This setup was checked with Gradle 8.5, OpenJDK 21 and JUnit 5.10.2.

## Register the target

Add it to the `targets` list of a run config:

```json
{"id": "my-target", "name": "My Thing (Solidity)", "language": "solidity",
 "prompt": "specs/my-target/prompt.md", "runner": "forge", "harness": "specs/my-target/harness"}
```

Then plan the run (`python -m fdlab.generate config/my-run.json`) and read the plan before sending anything.

## Keeping specifications out of training data

A specification and its tests lose their value as a benchmark once they are public: future models may have seen
them. If the target is meant for a study, keep `specs/` for that study in a private repository, and publish only
the framework and the results.
