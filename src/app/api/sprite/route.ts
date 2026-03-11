import { SpritesClient } from "@fly/sprites";
import { NextResponse } from "next/server";
import { PassThrough, Readable } from "node:stream";

export async function POST(request: Request) {
  const token = process.env.SPRITES_TOKEN;

  if (!token) {
    return NextResponse.json(
      { error: "SPRITES_TOKEN is not configured" },
      { status: 500 }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const command = (body.command as string) ?? "node count.js";

    const client = new SpritesClient(token);

    const sprite = await client.getSprite("my-sprite");

    const [cmdName, ...args] = command.split(/\s+/);
    const cmd = sprite.spawn(cmdName, args.length ? args : undefined, {
      tty: false,
    });

    const passThrough = new PassThrough();
    cmd.stdout.pipe(passThrough);
    cmd.wait().then(
      () => passThrough.end(),
      () => passThrough.destroy()
    );

    const webStream = Readable.toWeb(passThrough) as ReadableStream<Uint8Array>;
    return new Response(webStream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
      },
    });
    // const { stdout, stderr, exitCode } = await sprite.exec(command, {
    //   tty: true,
    // });
    // return NextResponse.json({ stdout, stderr, exitCode });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
