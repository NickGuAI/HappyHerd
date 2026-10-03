FROM node:24-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03

ENV HOME=/home/user

RUN mkdir -p /home/user /workspace \
    && chown -R node:node /home/user /workspace

USER node
WORKDIR /workspace