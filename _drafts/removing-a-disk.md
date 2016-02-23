---
layout: post
title: Removing a disk mapping from Cassandra
author: Alain Rodriguez
category: blog
tags: cassandra, configuration
---

I recently had to remove a disk from all the Apache Cassandra instances of a production cluster. This post purpose is to share the full process, optimizing the overall operation time and reducing the down time for each node, thanks to a few tips.

## Considerations

### Post use case

This post is about removing **one** disk by transferring its data to **one** other disk. Otherwise this will need to be adapted. All the following operations can be run in parallel, except the last step which is running the script, as it restarts the node.

### Naming in this post

`old-dir` refers to the folder mounted on the disk we want to remove, `tmp-dir` to the folder we will temporary use for the operation needs and new-dir to the existing data folder on the disk we want to keep.

## The 'natural' way

The rough and natural way of doing this is:

* stop one node
* move files
* change the configuration to mirror disk changes
* restart node and finally go to the next node.

Very simple, isn't it?

Well it is as simple as it is inefficient. Lets consider we have 10 files of 100GB on the disk to remove, on each node of a 30 nodes cluster, under a data folder called `old-dir`. Let's also consider it takes 10 hours to move the 10 files.

Then using the rough way of processing, nodes will be down for 10 hours each, and the operation will take very long:

        30 nodes * 10 h = 300 hours / 12.5 days

This is a very long time on a running production cluster, with probably more operations waiting in the TODO list. It will increase linearly if there is more data or more nodes. Also, if you might not be there after 10h and do the work on the day after, making this twice as long as it could theoretically be. This is clearly not the best way to go, even if it 'works'.

Plus, as nodes will be down for more than 3 hours (default max_hint_window_in_ms), a full repair of the node will be needed when they come back, increasing substantially the overall operation time.

Let's not do that.

## The (most?) efficient way

The main idea behind the process I will describe is that the `mv` command is an **instant command** if it is run from the **same physical disk**. The `mv` command will indeed **not** move the [inode](https://en.wikipedia.org/wiki/Inode) representing the file but just links pointing to it. This way moving PB of data takes less than a second.

The problem at this point is that data is not in the same disk! So `mv` command will have to physically move the data. That's why it is relevant to first `rsync` data from `old-dir` to `tmp-dir` (`tmp-dir` being in the same disk as `new-dir`).

Copying (not moving) data to a temporary folder outside from Cassandra data files allows us to run the the copy in parallel in all the nodes.

### Way to go

1. Make sure node is eligible for the removal (enough disk space left on the remaining disk)

        grep "data_fi" /etc/cassandra/conf/cassandra.yaml -A3
        df -h | grep cassandra # Or whatever the data directories are called or have in their path

2. 1st `rsync`

        screen -S rsync
        sudo rsync -azvP --delete-before <old-dir>/data/ <tmp-dir>

3. When first sync finishes, disable compaction and stop compaction to avoid files to be compacted and so transferring the same data again and again. See below for more details

        nodetool disableautocompaction
        nodetool stop compaction
        nodetool compactionstats

4. Place the script on the node, make it executable and configure variables (https://github.com/arodrime/cassandra-tools/blob/master/remove_disk/remove_extra_disk.sh#L2-L4)

        curl -Os https://github.com/arodrime/cassandra-tools/blob/master/remove_disk/remove_extra_disk.sh
        chmod u+x remove_extra_disk.sh
        vim remove_extra_disk.sh # Set 'User defined variables'

5. 2nd `rsync`

        screen -r rsync
        sudo rsync -azvP --delete-before <old-dir>/data/ <tmp-dir>

6. 3rd `rsync` (if needed, see the diff)

        sudo du -sh <old-dir> && sudo du -sh <tmp-dir>
        sudo rsync -azvP --delete-before <old-dir>/data/ <tmp-dir>

7. Change the configuration to mirror that a disk is not used anymore.

        sudo vim /etc/cassandra/conf/cassandra.yaml

8. Run the script (Node by node !) and monitor

        ./remove_extra_disk.sh
        sudo tail -100f /var/log/cassandra/system.log
        ...

### Some explanations

Let's describe the process using the same example than in the 'Natural' way of doing it.

#### About step 2

First `rsync` to `tmp-dir` from `old-dir`. Let's say this takes about 10 hours. This can be run in parallel in all the nodes though. Bandwidth used by `rsync` is tunable.

But meanwhile one compaction triggered and I now have 6 files of 100 GB and 1 of 350 GB.

#### About step 3

At this point we disable compactions, stop the compactions already running.  The purpose of this is to make the old-dir file totally immutable so we just have to copy the new data.

#### About step 5

The second `rsync` has to remove the 4 files that were compacted from `tmp-dir` during the first `rsync` (as compaction was not disabled by then), so that's why it is good to use the '--delete-before' option, avoiding Cassandra to compact more than we need once we will give back the data to cassandra. As this tmp-dir needs to be mirroring old-dir, using this option is fine. This new operation takes 3.5 hours, also runnable in parallel (Keep in mind C* won't compact anything for 3.5 hours)

I do not recommend doing step 3 (stop compaction) before the first `rsync` as we don't want the cluster to stop compacting for too long in most cases (10 hours in this example). If the dataset is small, it should be fine to do this before first `rsync` and only do 2 rsync.

At this point we have 950 GB in `tmp-dir`, but meanwhile clients continued to write on the disk. Let's say 50 GB more. Yet data on old-dir is now completely immutable so previous files are already synced, we copy the new data (since the last rsync).

#### About step 6

3rd `rsync` will take 0.5 hour, no compaction has run since the 2nd rsync, so `rsync` will only copy new data to `tmp-dir` this time. Still runnable in parallel.

#### About step 8

Then the script stop the node, so should be run sequentially, and perform 2 more rsync, the first one to take the diff between the end of 3rd `rsync` and the moment you stop the node, it should be a few seconds, maybe minutes, depending how fast the script was run after 3rd `rsync` ended and on the throughput.

The second `rsync` in the script is a 'useless' one. I just like to control things. Running it, we expect to see that there is no diff. It is just a way to stop the script if for some reason data is still being appended to old-dir (Cassandra not stopped correctly or some weird behaviour). I guess this could be replaced by a check on Cassandra service being down.

Next step in the script is to move all the files from `tmp-dir` to `new-dir` (the proper data dir remaining after the operation). This is an instant operation as files are not really moved as they already are on the disk as mentioned earlier.

Finally the script unmount the disk and remove the `old-dir`.

## Conclusions

So the 'Natural' way (stop node, move, start node) in our example takes:

    10h * 30 = 300h.

Plus each node is down for 10 hours, so nodes need to be repaired as 10 hours is higher than hinted handoff limit of 3 hours (default).

The full 'Efficient' operation, allowing transferring the data in parallel, takes:

    10h + 3.5h + 0.5h + (30 * 0.1h) = 17h

Nodes are down for about 5-10 min each. No further operation needed.
