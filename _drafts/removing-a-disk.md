---
layout: post
title: Removing a disk mapping from Cassandra
author: Alain Rodriguez
category: blog
tags: cassandra, configuration
---

I recently had to remove a disk from all the Apache Cassandra instances of a production cluster. This post purpose is to share the full process, optimizing the overall operation time and reducing the down time for each node.

## Considerations

This post is about removing **one** disk by transferring its data to **one** other disk, the process will need to be modified to remove more than one disk or to move data to multiple disks. All the following operations can be run in parallel, except the last step which is running the script, as it involve restarting the node.

There are three directories we need to consider:

* `old-dir` refers to the folder mounted on the disk we want to remove.
* `tmp-dir` is a folder we will temporary use for the operation needs.
* `new-dir` is the existing data folder on the disk we want to keep.

## The 'natural' way

The rough and natural way of doing this is:

1. Stop one node.
2. Move the SSTables from the `old-dir` to the `new-dir`.
3. Change the `data_file_directories` in *cassandra.yaml* to mirror disk changes.
4. Restart the node.
5. Go to the next node and repeat the same steps.

Very simple, isn't it?

Well it is as simple as it is inefficient. Lets consider we have 10 files of 100GB each on the disk to remove, on each node of a 30 nodes cluster, under a data folder called `old-dir`. Let's also consider it takes 10 hours to move the 10 files.

Then using the rough way of processing, nodes will be down for 10 hours each, and the operation will take very long:

        30 nodes * 10 h = 300 hours / 12.5 days

This is a very long time on a running production cluster, with probably more operations waiting in the TODO list. It will increase linearly if there is more data or more nodes. Also, if you might not be there after 10h and do the work on the day after, making this twice as long as it could theoretically be. This is clearly not the best way to go, even if it 'works'.

Plus, as nodes will be down for more than 3 hours (default `max_hint_window_in_ms`), hints will no longer be stored for the node, meaning a full node repair will be needed every time a node comes back online, increasing substantially the overall operation time.

Let's not do that.

## The (most?) efficient way

The main idea behind the process I will describe is that the `mv` command is an **instant command** if it is run from the **same physical disk**. The `mv` command will indeed **not** move the [inode](https://en.wikipedia.org/wiki/Inode) representing the file but just links pointing to it. This way moving Petabytes of data takes less than a second.

The problem is the `mv` command will need to physically copy the data between disk as our source and destination directories are on different disks. That's why it is relevant to first [rsync](https://en.wikipedia.org/wiki/Rsync) data from `old-dir` to `tmp-dir` (`tmp-dir` being in the same disk as `new-dir`).

Copying (not moving) data to a temporary folder outside from Cassandra data files allows us to run the the copy in parallel in all the nodes, without shutting them down.

### Way to go

Make sure to run this procedure, at least every `rsync`, using a [screen](http://aperiodic.net/screen/quick_reference). This is a best practice while running operations to avoid any unexpected network hiccup to interfere with the procedure. It also allows teammates to take over easily.

1. Make sure there is enough disk space on the target disk for all the data on the `old-dir`.

2. First `rsync`

        sudo rsync -azvP --delete-before <old-dir>/data/ <tmp-dir>

    **Explanations**: First `rsync` to `tmp-dir` from `old-dir`. This can be run in parallel in all the nodes though.
    Options in use are:
    
    * `-a`: Preserves permissions, owner, group...
    * `-z`: Compress data for transfer.
    * `-v`: Gives detailed informations (Verbose)
    * `-p`: Shows progress.
    * `--delete-before`: Removes any existing file in the destination folder that is not present in the source folder.
    * Bandwidth used by `rsync` is tunable using the `--bwlimit` options, see the [man page](http://linux.die.net/man/1/rsync) for more information. A good starting value could be the `stream_throughput_outbound_megabits_per_sec` value from `cassandra.yaml` which defaults to 200. Depending on the network, the bandwidth available and the needs, it is possible to stop the command, tune the `--bwlimit` and restart `rsync`.

    **Example**: This takes about 10 hours in our example as we are moving the same dataset as in the 'natural' way of doing this described above. The difference is we can run this in parallel on all the nodes as we can control bandwidth and there is no need for any node to be down.

3. When first sync finishes, optionally disable compaction and stop compaction to avoid files to be compacted and so transferring the same data again and again. This is an optional step as there is a trade off between the amount of down time required later and keeping compaction up to date. If your cluster is always behind in compaction you may want to skip this step.

        nodetool disableautocompaction
        nodetool stop compaction
        nodetool compactionstats

    **Explanations**: These commands disable any additional compactions from starting then stop the compactions which are already running.  The purpose of this is to make the `old-dir` file totally immutable so we just have to copy the new data.

    *Warning*: Keep in mind Cassandra won't compact anything in the period between this step and the restart of the node. This will impact the read performances after some time. So I do not recommend doing it before the first `rsync` as we don't want the cluster to stop compacting for too long in most cases. If the dataset is small, it should be fine to disable/stop compactions before the first `rsync`. On the other hand, if the dataset is big and very active it might be a good idea to perform multiple rsync before disabling compaction, to mitigate this, until size of `tmp-dir` is close enough to `old-dir` size. This basically makes the operation longer, but safer.

    **Example**: In our example, let's say one compaction triggered during the first rsync, before we disabled it. So we now have 6 files of 100 GB and 1 of 350 GB. The problem is there is now a new file of 350 GB and `rsync` does not know this is the same data as in the 4 100 GB files already present in `tmp-dir`. Disabling compaction will avoid this behavior after the next `rsync`.

4. Place the script on the node, make it executable and configure variables (https://github.com/arodrime/cassandra-tools/blob/master/remove_disk/remove_extra_disk.sh#L2-L4)

        curl -Os https://github.com/arodrime/cassandra-tools/blob/master/remove_disk/remove_extra_disk.sh
        chmod u+x remove_extra_disk.sh
        vim remove_extra_disk.sh # Set 'User defined variables'

5. Second `rsync`

        sudo rsync -azvP --delete-before <old-dir>/data/ <tmp-dir>

    **Explanations**: The second `rsync` has to remove the files that were compacted during the first `rsync` from `tmp-dir` as compactions were not yet disabled. It is good to use the '--delete-before' option, which keeps Cassandra from compacting more than is needed once we will give it the data back. As `tmp-dir` needs to be mirroring `old-dir`, using this option is fine. This second `rsync`is also runnable in parallel across the cluster.

    **Example**: This new operation takes 3.5 hours in our example.
    At this point we have 950 GB in `tmp-dir`, but meanwhile clients continued to write on the disk.

6. Third `rsync` to copy the new files.

        sudo du -sh <old-dir> && sudo du -sh <tmp-dir>
        sudo rsync -azvP --delete-before <old-dir>/data/ <tmp-dir>

    **Explanations**: Existing files are now 100% immutable as they have never compacted. Now, we just need to copy new files that were flushed in `old-dir` as Cassandra is still running. Again, this is runnable in parallel.

    **Example**: Let's say we have 50 GB of new files. It takes 0.5 hours to copy them in our case.

7. Remove `old-dir` from the `data_file_directories` list in *cassandra.yaml*.

        sudo vim /etc/cassandra/conf/cassandra.yaml

8. Run the script (Node by node !) and monitor

        ./remove_extra_disk.sh
        sudo tail -100f /var/log/cassandra/system.log
        ...

    **Explanations**
    * The script stops the node, so should be run *sequentially*.
    * It performs 2 more rsync:
        * The first one to take the diff between the end of 3rd `rsync` and the moment you stop the node, it should be a few seconds, maybe minutes, depending how fast the script was run after 3rd `rsync` ended and on the throughput.
        * The second `rsync` in the script is a 'control' one. I just like to control things. Running it, we expect to see that there is no diff. It is just a way to stop the script if for some reason data is still being appended to `old-dir` (Cassandra not stopped correctly or some other weird behavior). I guess this could be replaced/completed with a check on Cassandra service making sure it is down.
    * Next step in the script is to move all the files from `tmp-dir` to `new-dir` (the proper data folder remaining after the operation). This is an instant operation as files are not really moved as they already are on the disk as mentioned earlier.
    * Finally the script unmount the disk and remove the `old-dir`.

    **Example**: This will take a few minutes depending on how fast the script was run after the last `rsync`, the write throughput of the cluster and the data size (as it will impact Cassandra starting time).
    Let's consider it takes 6 minutes (0.1 hours).

## Conclusions

So the 'natural' way (stop node, move, start node) in our example takes:

    10h * 30 = 300h

Plus, each node is down for 10 hours, so nodes need to be repaired as 10 hours is higher than hinted handoff limit of 3 hours (default).

The full 'efficient' operation, allowing transferring the data in parallel, takes:

    10h + 3.5h + 0.5h + (30 * 0.1h) = 17h

Nodes are down for about 5-10 min each. No further operation needed.
