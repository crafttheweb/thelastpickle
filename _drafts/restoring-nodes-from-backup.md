---
layout: post
title: Restoring a Cluster from Snapshot
author: Patricia Gorla
category: blog
tags: cassandra, restore, cluster
---

// tag: cluster-wide operation

// Walk through steps taken with SocialFlow.

Shut down Cassandra.

Download cass_snapshot_link from github.com/amorton/cass_snapshot_link.

Symlink desired snapshot to /tmp directory, chown to cassandra user.

Remove stale data.

Save old config.

Edit yaml with pointers to new directory, new seed nodes.

Note: You will still see the old seed nodes bc they are embedded in the system keyspace.
