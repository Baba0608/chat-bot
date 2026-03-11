import { SpritesClient } from "@fly/sprites";
import { NextResponse } from "next/server";

export async function POST() {
  const token = process.env.SPRITES_TOKEN;

  if (!token) {
    return NextResponse.json(
      { error: "SPRITES_TOKEN is not configured" },
      { status: 500 }
    );
  }

  try {
    const client = new SpritesClient(token);

    // check if sprite exists and use the same sprite, else create a new one
    let sprite = await client.getSprite("my-sprite");
    if (!sprite) {
      console.log("Sprite does not exist, creating new one");
      sprite = await client.createSprite("my-sprite");
    } else {
      console.log("Sprite exists, using existing one");
    }

    const { stdout } = await sprite.exec("echo hello");

    return NextResponse.json({
      stdout: stdout,
      stderr: "",
      exitCode: null,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
        stdout: null,
        stderr: "",
        exitCode: null,
      },
      { status: 500 }
    );
  }
}
