FROM node:22-alpine AS dev
WORKDIR /app
EXPOSE 8000
ENV PORT 8000
ENV REDIS_URL=redis://redis:6379/1

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/app/npm \
    npm set cache /app/npm && \
    npm install

COPY . /app

RUN npx baml-cli generate

CMD ["/bin/sh", "-c", "npm run dev"]
