import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
// Instagram Reels rejects yuvj420p (JPEG full-range color) with error 2207076
// during media processing. Force yuv420p (limited range) for compatibility.
Config.setPixelFormat("yuv420p");
