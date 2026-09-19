.PHONY: help build push pull up down

IMAGE := jackcky/come-again:latest
NAME  := come-again
PORT  := 8080

help:
	@echo "Available targets:"
	@echo "  make build      # Build the container image"
	@echo "  make push       # Push the image to Docker Hub"
	@echo "  make pull       # Pull the image from Docker Hub"
	@echo "  make up         # Start the container in detached mode"
	@echo "  make down       # Stop and remove the container"

build:
	docker build --platform linux/amd64 -t $(IMAGE) .

push:
	docker push $(IMAGE)

pull:
	docker pull $(IMAGE)

up: down
	docker run -d --platform linux/amd64 --name $(NAME) --restart unless-stopped -p $(PORT):80 $(IMAGE)

down:
	@docker rm -f $(NAME) >/dev/null 2>&1 || true
