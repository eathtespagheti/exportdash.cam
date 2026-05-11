import fs from 'fs';
import protobuf from 'protobufjs';
import { DashcamMP4 } from './src/lib/dashcam-mp4';

async function main() {
  console.log('Loading protobuf schema...');
  const protoText = fs.readFileSync('public/dashcam.proto', 'utf8');
  const root = protobuf.parse(protoText, { keepCase: true }).root;
  const seiMetadata = root.lookupType('SeiMetadata') as any;

  const folder = 'clips/SentryClip/2026-05-04_20-34-28';
  const files = fs.readdirSync(folder).filter(f => f.endsWith('.mp4'));

  for (const file of files) {
    console.log(`\nReading video file ${file}...`);
    const buffer = fs.readFileSync(`${folder}/${file}`);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

    const mp4 = new DashcamMP4(arrayBuffer);
    
    try {
      const messages = mp4.extractSeiMessagesWithFrameIndex(seiMetadata);
      console.log(`Extracted ${messages.length} SEI messages from ${file}`);
    } catch (err) {
      console.error(`Error extracting SEI messages from ${file}:`, err);
    }
  }
}

main().catch(console.error);