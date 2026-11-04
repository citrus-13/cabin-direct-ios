// Original synthetic media for repeatable tests. No user files or outside services.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const folder = new URL('../test/fixtures/', import.meta.url);
await mkdir(folder, { recursive: true });
const sampleRate = 16000, seconds = 18, samples = sampleRate * seconds;
const wav = Buffer.alloc(44 + samples * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVE', 8);
wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
for (let n = 0; n < samples; n++) {
  const t = n / sampleRate;
  const envelope = Math.min(1, t * 5, (seconds - t) * 5);
  const frequency = [220, 261.63, 329.63][Math.floor(t / 6) % 3];
  wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * frequency * t) * 1200 * envelope), 44 + n * 2);
}
await writeFile(new URL('cabin-tone.wav', folder), wav);
await writeFile(new URL('cabin-demo.lrc', folder), '[ti:Cabin 原创验证音轨]\n[ar:本地测试]\n[00:00.00]这是本地验证的第一句\n[00:04.00]歌词应当随时间向前\n[00:08.00]暂停时文字也停下来\n[00:12.00]继续播放再一起出发\n[00:16.00]本次验证即将完成\n', 'utf8');
console.log(`Created original test fixtures in ${fileURLToPath(folder)}`);
