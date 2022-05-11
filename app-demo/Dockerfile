# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
FROM ubuntu:latest
RUN apt-get update -y
RUN apt-get install -y python3-pip python3-dev build-essential
RUN pip3 install --upgrade pip
COPY ./app/requirements.txt .
RUN pip3 install -r ./requirements.txt
COPY ./app /app
WORKDIR /app
EXPOSE 80
ENTRYPOINT ["python3"]
CMD ["main.py"]
