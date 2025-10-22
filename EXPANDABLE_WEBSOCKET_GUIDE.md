# Expandable WebSocket System Guide

This WebSocket system is designed to be **easily expandable** for any number of job types. Follow this guide to add new job types.

## Architecture Overview

```
┌─────────────────┐
│  Frontend (UI)  │  Uses: useWebSocket hook
└────────┬────────┘
         │
         │ WebSocket Connection
         ↓
┌──────────────────────────┐
│  WebSocket Server (Bun)  │  Listens to: CHANNELS[]
└────────┬─────────────────┘
         │
         │ Redis Pub/Sub
         ↓
┌─────────────────────────┐
│  Worker (Express API)   │  Publishes to: Redis Channels
└─────────────────────────┘
```

## How to Add a New Job Type

### Step 1: Add Channel to WebSocket Server

**File:** `Bitrix-Websocket-Server/index.ts`

```typescript
const CHANNELS = [
  "job-updates",      // Existing
  "file-upload",      // Existing
  "bulk-upload",      // Existing
  "pdf-extraction",   // Existing
  "your-new-channel", // 👈 ADD YOUR CHANNEL HERE
] as const;
```

That's it! The server automatically subscribes to all channels.

---

### Step 2: Create Worker Route

**File:** `Bitrix-Worker-Code/routes/your-new-job.ts`

```typescript
import { Router } from "express";
import type { Request, Response } from "express";
import Redis from "ioredis";
import { v4 as uuidv4 } from "uuid";

const router = Router();
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

// Helper function to publish progress
async function publishProgress(
  channel: string,
  jobId: string,
  data: Record<string, any>
) {
  const payload = {
    jobId,
    timestamp: Date.now(),
    ...data,
  };
  await redis.publish(channel, JSON.stringify(payload));
  console.log(`📡 Published to ${channel}:`, payload);
}

router.post("/your-endpoint", async (req: Request, res: Response) => {
  const jobId = uuidv4();

  try {
    // Send initial response
    res.status(202).json({ jobId, message: "Job started" });

    // Publish initial progress
    await publishProgress("your-new-channel", jobId, {
      status: "processing",
      progress: 0,
      // ... your custom fields
    });

    // Do your work here...
    // Publish updates as needed
    await publishProgress("your-new-channel", jobId, {
      status: "processing",
      progress: 50,
    });

    // Final completion
    await publishProgress("your-new-channel", jobId, {
      status: "completed",
      progress: 100,
    });
  } catch (error) {
    await publishProgress("your-new-channel", jobId, {
      status: "failed",
      error: error.message,
    });
  }
});

export default router;
```

Then register it in `index.ts`:

```typescript
import yourNewJob from "./routes/your-new-job";
app.use("/api", yourNewJob);
```

---

### Step 3: Use in Frontend

**Example Component:**

```tsx
"use client";

import { useWebSocket, type BaseJob } from "@/hooks/use-websocket";

interface YourJobType extends BaseJob {
  // Add your custom fields
  customField: string;
}

export function YourComponent() {
  const { jobs, activeJobs, isConnected } = useWebSocket<YourJobType>({
    channels: ["your-new-channel"], // Filter to your channel only
  });

  return (
    <div>
      <h3>Your Job Progress</h3>
      {activeJobs.map((job) => (
        <div key={job.jobId}>
          {job.customField} - {job.status}
        </div>
      ))}
    </div>
  );
}
```

---

## Examples

### 1. Deal Screening (Existing)

**Channel:** `job-updates`

```tsx
const { jobs } = useWebSocket({ channels: ["job-updates"] });
```

### 2. File Upload

**Channel:** `file-upload`

```tsx
const { jobs } = useWebSocket<FileUploadJob>({
  channels: ["file-upload"]
});
```

### 3. Multi-Channel Monitoring

Watch multiple job types at once:

```tsx
const { jobs } = useWebSocket({
  channels: ["job-updates", "file-upload", "bulk-upload"]
});
```

---

## Message Format

All messages follow this structure:

```typescript
{
  jobId: string;           // Unique job identifier
  channel: string;         // Which channel (auto-added by server)
  status: "queued" | "processing" | "completed" | "failed";
  progress?: number;       // 0-100
  timestamp: number;       // Unix timestamp
  // ... your custom fields
}
```

---

## Testing

### 1. Start WebSocket Server

```bash
cd Bitrix-Websocket-Server
bun run index.ts
```

### 2. Start Worker

```bash
cd Bitrix-Worker-Code
npm start
```

### 3. Start Frontend

```bash
cd Bitrix24
npm run dev
```

### 4. Trigger a Job

```bash
curl -X POST http://localhost:8080/api/file-upload \
  -F "file=@test.pdf" \
  -F "userId=123"
```

Watch the WebSocket logs to see real-time updates!

---

## Scaling

The system scales because:

1. **WebSocket Server** subscribes to all channels automatically
2. **Worker** can publish to any channel without changes
3. **Frontend** filters by channel client-side

To add a new job type:
- Add 1 line to `CHANNELS[]`
- Create 1 new route
- Use the same `useWebSocket` hook

**No infrastructure changes needed!**
