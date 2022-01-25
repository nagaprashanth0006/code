import sys
import logging
import multiprocessing
from time import sleep
from fabric.api import *
from inspect import stack
from datetime import datetime

#for i in dir(multiprocessing):
    #if not i.startswith('_'):
        #print(i) 
#exit(0)

timestart = datetime.now()
logger = logging.getLogger(__name__)


class FabricHostFilter(logging.Filter):

    # This logging filter adds the availablity of the Fabric target host

    def filter(self, record):
        if env.host:
            record.host = env.host
        else:
            record.host = 'localhost'
        return True

def get_logger():
    logger.addHandler(multiprocessing.get_logger())
    logger.setLevel(logging.INFO)
    LOG_FORMAT = '%(asctime)s %(host)18s [%(levelname)4s] %(message)s'
    fh = logging.FileHandler('test.log')
    logger.addFilter(FabricHostFilter())
    logging.getLogger('fabric').setLevel(logging.CRITICAL)
    logging.getLogger('requests').setLevel(logging.CRITICAL)

    try:
        sh = logging.StreamHandler(stream=sys.__stdout__)
    except TypeError:
        sh = logging.StreamHandler(sys.__stdout__)
    sh.setLevel(getattr(logging, logging.INFO))

    fmt = logging.Formatter(LOG_FORMAT, datefmt="%Y%m%d%H%M%S")
    fh.setFormatter(fmt)
    sh.setFormatter(fmt)

    if len(logger.handlers) != 2:
        logger.addHandler(fh)
        logger.addHandler(sh)

def stop(args):
    container = args[0]
    q = args[1]
    if container.startswith("one"):
        q.send("PRE:STARTED")
        sleep(5)
        q.send("PRE:END")

    q.send("CMD:STARTED")
    sleep(4)
    q.send("CMD:END")
    q.send("DONE")
    return True

def remove(container):
    print("Inside remove func")
    if container.startswith("one"):
        print("Prerequisites...")
        sleep(2)

    print("Remove command for %s" % container)
    sleep(4)
    return True
    
def create(container):
    print("Inside create func")
    if container.startswith("one"):
        print("Prerequisites...")
        sleep(2)

    print("Create command for %s" % container)
    sleep(4)
    return True

def start(container):
    print("Inside start func")
    if container.startswith("one"):
        print("Prerequisites...")
        sleep(2)

    print("Start command for %s" % container)
    sleep(4)
    return True

def task_handler(containers):
    # Check who's calling this function. This is required to
    # create the multiprocessing worker pool with proper params.
    caller = stack()[1][3]

    print("Caller:", caller)
    print("Given param:", containers)
    print("Input length:", len(containers))

    # Get the logical CPU core count.
    # Note: On SMT enabled CPUs, each core might be reported as
    # 2 cores as SMT enables 2 threads to simultaneously run on a
    # single physical core.
    cpus = multiprocessing.cpu_count()
    print(cpus, containers)

    ## Returns a tuple of multiprocessing.Connection objects
    ## rec for receiving messages by parent. q object for child
    ## to put messages into.
    rec, q = multiprocessing.Pipe()

    # Check and assign the target functions to workers in pool.
    if caller == "rolling_stop":
        i = 0                                   ## Ptr to the tuple of containers
        while i < len(containers):
            subset = containers[ i : i + cpus]  # Get the subset of containers.
            print(subset)
            i += cpus

            # Create a pool of "NUM OF CPU CORES" + 1 workers
            pool = multiprocessing.Pool(processes = cpus + 1)

            # Map the tuples of container and queue to the target function
            res = pool.map_async(stop, [(container, q) for container in subset])
            pool.close()

            complete = False
            prere = "PENDING"
            cmd = "PENDING"
            print("#####################", complete)
            while not complete:
                if (rec.poll()):
                    data = rec.recv()
                    if data == "DONE":
                        complete = True
                    elif data.startswith("PRE"):
                        prere = data.split(":")[-1]
                    elif data.startswith("CMD"):
                        cmd = data.split(":")[-1]
                    print("Prerequisites:", prere, end = "\r")
                    print()
                    print("Stop command:", cmd, end = "\r")
                    print()
                else:
                    print("No result yet...", end = '\r')
                    print()

                sleep(0.2)

            complete = False
            print("RESULT: ", res.get())
            print()
            print()
            pool.terminate()

    elif caller == "rolling_remove":
        pool.map(remove, containers)
    elif caller == "rolling_create":
        pool.map(create, containers)
    elif caller == "rolling_start":
        pool.map(start, containers)
    return

def rolling_stop(*container):
    task_handler(container)

def rolling_remove(*container):
    task_handler(container)

def rolling_create(*container):
    task_handler(container)

def rolling_start(*container):
    task_handler(container)

if __name__ == '__main__':
    rolling_stop("one", "two", "three", "test1", "test2", "test3", "test4")
    print("Time taken:", datetime.now() - timestart )
