---
layout: post
title: "Read Something, Code Something, Write Something"
---

## Read Something

### [Postgres at Urban Airship, Adventures in data stores at a growing startup](http://wiki.postgresql.org/images/7/7f/Adam-lowry-postgresopen2011.pdf)

Another good presentation from the team at [Urban Airship](http://urbanairship.com/). 

* They ship a lot of bits. 
* Sad to see Cassandra could not sustainably scratch their itch. 
* I wonder how much of the data model confusion has to do with super columns, and how much is just inherent in Column Families. 
* The Indexing story in Cassandra is very different to a RDBMS, maybe [CASSANDRA-2915](https://issues.apache.org/jira/browse/CASSANDRA-2915) is the answer. 
* Yup HH and GC can still hurt. 
* What do we need to make people trust Cassandra more ? Solid backup advice? Stability under load? Less Bugs?

## Code Something


## Write Something
