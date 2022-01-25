import paramiko
import base64
import multiprocessing
from time import time, sleep
from datetime import datetime
from pythonping import ping
from random import randint


def test():
    command = "df -h"
    # host = "sakshi"
    # username = "root"
    # password = base64.b64decode(b"cm9vdA==").decode("utf-8")

    host = "master"
    username = "prashanth"
    client = paramiko.SSHClient()
    password = base64.b64decode(b"bXBwZW5ndWlu").decode("utf-8")

    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, username=username, password=password)
    _stdin, stdout, _stderr = client.exec_command(command)
    print(stdout.read().decode().strip())
    client.close()


"""

private_key = paramiko.RSAKey.from_private_key_file("M:\\Repos\\.ssh\\id_rsa")
client_with_key = paramiko.SSHClient()
policy = paramiko.AutoAddPolicy()
client_with_key.set_missing_host_key_policy(policy=policy)
client_with_key.connect(host, username=username, pkey=private_key)
_stdin, stdout, _stderr = client_with_key.exec_command("whoami")
# print(stdout.read().decode().strip())
client_with_key.close()

"""

## Server pooling
# __*__ TBD __*__
ctr = 0
servers_list = [
    "sakshi",
    "master",
    "node1",
    "node2",
]

stdouts = []
stderrs = []


def run_ssh_script(server):
    ssh_script = """
    #!/bin/bash
    user=$(whoami)
    host=$(hostname)
    sleep 1
    echo "Hello from: $user@$host"
    """

    username = "prashanth"
    password = base64.b64decode(b"bXBwZW5ndWlu").decode("utf-8")

    if server.strip() == "sakshi":
        username = "root"
        password = base64.b64decode(b"cm9vdA==").decode("utf-8")

    if not ping(server, count=1, match=True).success():
        return

    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(server, username=username, password=password)

        _stdin, stdout, stderr = client.exec_command(ssh_script)
        output = stdout.readlines()

        stdouts.append([str(time()) + " - " + line.strip() for line in stdout])
        stderrs.append([str(time()) + " - " + line.strip() for line in stderr])
        print(
            [
                datetime.now().strftime("%m/%d/%Y %H:%M:%S") + " - " + line.strip()
                for line in output
            ]
        )

        client.close()
    except paramiko.ssh_exception.SSHException:
        pass


def test2(value):
    
    print("Inside Test2. Value:", value, rand)
    sleep(5)


def task():
    global custom_data
    custom_data = "Data from worker"
    print(f"Worker executing with: {custom_data}", flush=True)
    sleep(1)


def worker_init(custom):
    global custom_data
    custom_data = custom
    print(f"Initializing worker with: {custom_data}", flush=True)


if __name__ == "__main__":
    # beginning_of_time = time()
    print("No. of servers:", len(servers_list))
    start = time()
    MULTIPROCESS_PROCESS_LIMIT = 6
    print("Multiprocessing count:", MULTIPROCESS_PROCESS_LIMIT)
    pool = multiprocessing.Pool(processes=MULTIPROCESS_PROCESS_LIMIT)
    pool.map(test2, servers_list)
    pool.close()
    pool.join()
    print("Took time:", time() - start)

    # data = "Global variable from main"
    # with multiprocessing.Pool(2, initializer=worker_init, initargs=(data,)) as pool:
    #     for _ in range(4):
    #         pool.apply_async(task)
    #     pool.close()
    #     pool.join()

    # print("Total time:", time() - beginning_of_time)
