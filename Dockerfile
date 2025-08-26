# Use the official Bun image
FROM oven/bun:1.1.13

# Set the working directory inside the container
WORKDIR /app

# Copy package files and install dependencies
COPY package.json bun.lock ./
RUN bun install

# Copy the rest of your application code
COPY . .

# Expose the port your app runs on
EXPOSE 8080

# Start the server using Bun
CMD ["bun", "index.ts"]