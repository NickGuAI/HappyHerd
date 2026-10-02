# Image generation

One prompt becomes one PNG. The module owns the whole path itself — which account to ask, the
request, the validation of what comes back, and the file it publishes — so it needs nothing beyond
the accounts already configured and the configuration that names the generated-files folder.

```ts
import { ConfigModule, ImageGenerationModule } from "@slopus/happy-agent-modules";

const config = await ConfigModule.load();
const imageGeneration = new ImageGenerationModule(config);
```

The configuration module is the only thing it takes: it owns the Codex accounts an image may be
generated on and the generated-files folder a finished image is published into, so the module asks
it for both rather than being handed a registry and a path.

## The tool

Every model receives one tool, **`codex_imagegen`**, carrying the guidance Codex models were
trained on. The name is Codex's because the capability is — images are generated on Codex accounts
— and because Codex models cannot be given a plain `imagegen`: the Responses API reserves that name
and the `image_gen` namespace for its own built-in image tool and rejects the whole request when a
definition under either differs from the built-in one. Every other family reads the same guidance
rather than a second surface that would have to be kept in step with this one. It also accepts an
explicit `null` for an unused image selector, which Codex models emit in place of omitting the
field.

It takes a prompt, and for an edit either up to five `referenced_image_paths` or
`num_last_images_to_include` — never both. It is `durable: false`, because a generation is billed
work that cannot safely be repeated, requires Auto or Full access, and always asks for review;
elevation is requested only when the call names a local path to read.

## Accounts

```text
                    codex_imagegen
                          |
                          v
              this chat's own Codex account
                          |
                          | definitive account refusal only
                          v
             remaining accounts in round-robin order
                          |
                          v
              ~/Happy/Generated/<tool-call>.png
```

Codex cloud accounts supply the capability; Bedrock does not. A definitive refusal — signed out,
out of credit, not entitled — moves to the next account. A transport failure or a malformed answer
stops there, because the first request may already have been billed.

## Images an edit is built from

`referenced_image_paths` are read straight off this machine, as `~`-relative, absolute, or
working-directory-relative paths. Each image is measured before it is read, then decoded and
normalized under a 32 MiB aggregate source bound and a 48 MiB encoded-request bound.

`num_last_images_to_include` uses the last few images the agent was actually shown: images a person
attached, and images this module generated. They are held in memory for the length of the process,
newest five per agent, because nothing else keeps the bytes — the durable history records that an
image existed, not what was in it.

## The finished image

What comes back is proven to be a real PNG — base64, signature, and a decoder that can read the
picture — before it becomes a file. It is written under a temporary name and published by rename,
so a reader never sees a partial image, and the model is handed both the path and the image itself
so it can decide whether to iterate.
