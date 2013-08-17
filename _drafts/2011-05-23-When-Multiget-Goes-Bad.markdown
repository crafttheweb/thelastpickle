---
layout: post
title: "When Multiget Goes Bad"
---

The `multiget_slice` and `batch_mutate` Cassandra [Thrift API](http://wiki.apache.org/cassandra/API) functions allow the client to fetch or write to multiple rows in one call. Which is a good thing as it allows the client to get more done in one network call. But like any good thing too much of it is a problem.

Cassandra [borrows](http://wiki.apache.org/cassandra/ArchitectureInternals) from the [Staged Event Driven Architecture (SEDA)](http://www.eecs.harvard.edu/~mdw/papers/seda-sosp01.pdf) paper and uses several (thread pool) *Stages* to process requests. In particular the `ReadStage` is used to read data during a query and the `MutationStage` used to write during a mutation. They are bounded thread pools, controlled by the `concurrent_reads` and `concurrent_writes` settings in `conf/cassandra.yaml`.

The bounded thread pool protects the IO resources of the server, creating a "well conditioned" service as described in "2. Background and Related Work" in the SEDA paper. Once the read or write load on the server increases beyond the allocated threads for the stage requests must wait in the stage queue. At this point the stage has reached it's maximum throughput, additional requests will not cause the service to degrade. 

Request latency will increase however throughput will remain steady. The latency for an individual request may be dominated by the wait time in the stage queue. To the point that it times out while in the queue by exceeding `rpc_timeout`. While the actual time processing the request may be comparable to the time taken at a lighter request load as the load on the IO system will be similar. The wait time in the queue is more predictable and proportional than the wait time on an overwhelmed IO system. 

The use of different stages also isolates one type of request from short term spikes in another. An increase in the read workload will have little impact on the write performance of Cassandra. 

## Dude where's my throughout?

A call to the thrift API insert() function results in a single `RowMutation` been sent to the replicas for the key. Likewise a call to the get\_slice() function results in a single `ReadCommand` been sent out to the replicas. These API calls will occupy one slot / thread in the stage. Maximum request throughput will be similar to the maximum throughput for `RowMutation`'s and `ReadCommand`'s.

However batch\_mutate() creates a `RowMutation` for every row supplied by the client (in v0.8 mutations for multiple column families are collapsed into one row mutation). And multiget_slice() will create a `ReadCommand` for each row requested. These API calls have the potential to occupy many concurrent threads in a stage.

If the client sends a batch\_mutate() with more than `concurrent_writes` rows (default is 32 for v0.8) it *may momentarily* saturate the write stage for the replicas. Other writes received at this time will begin to queue. Given how fast the [write path](http://thelastpickle.com/2011/04/28/Forces-of-Write-and-Read/) is in Cassandra sending 32 rows is not going to be much of a problem.

Overloading a multiget\_slice() request is probably easier to do given reads typically take longer than writes. Again any request with more than `concurrent_reads` (default 32 in v0.8) *may momentarily* saturate the read stage for the replicas. There is a potential double whammy here, at higher Consistency Levels any inconsistency in the response from the nodes must be resolved and repaired requiring the read to be performed a second time. Additionally if Read Repair is enabled all replicas will be involved in the read, not just those needed to meet the requested Consistency Level. A read for a single row may happen twice and require an additional write.

Consider requesting to read 100 rows in a multi get where read latency is typically 50ms and `conurrent_reads` is 32. If all the `ReadCommands` start at the same time, it could take them roughly 150ms to complete. During which time all other read requests will wait in the queue. 

Using a high number of rows with batch\_mutate or multiget\_slice calls can result in the maximum request throughput been reduced which maybe an issue in some workloads. The individual `RowMutation` and `ReadCommand` throughput should be largely un affected. 

(I also think that dragging large amounts of data through the network stack and JVM is inefficient, as is materialising it client side.)

## What I am not saying

I am **not** saying batch\_mutate and multiget\_slice are bad. They are the most useful calls on the Thrift API and necessary to efficiently read and write data to Cassandra. 

I **am** saying that clients asking for [moar](http://27.media.tumblr.com/tumblr_kqsa7yzlyG1qzma4ho1_500.jpg) data may not always be the best idea. In that respect Cassandra is like any other database, the purpose of this post was to explain why.

If request throughout is important avoid workloads that require clients to read lots of rows at once. Consider using more clients that request fewer rows or changing the data model. Use batch\_mutate to assist with dernormalising data or storing custom secondary indexes, not for performance.  

## In Motion

It's possible see the affect of saturating the read stage using the stress testing tools available in the Cassandra source distribution.

To make it easier to saturate the read stage, reduce the number of concurrent read requests to 2 in `conf/cassandra.yaml`.

'''yaml
concurrent_reads: 2
'''

In the source distribution build the main Cassandra project, then build the stress tests:

'''
$ ant 
$ cd contrib/stress/
$ ant
'''

Insert some data:

'''
$ contrib/stress/bin/stress -d 127.0.0.1 -n 1000000 -o insert
'''



aarons-MBP-2011:apache-cassandra-0.7.6-2-src aaron$ contrib/stress/bin/stress -d 127.0.0.1 -n 500000 -t 2 -g 1 -o multi_get  
total,interval_op_rate,interval_key_rate,avg_latency,elapsed_time
163633,16363,16363,1.096966993210416E-4,10
336046,17241,17241,1.0702209230162459E-4,20
500000,16395,16395,1.0752406162704174E-4,29
aarons-MBP-2011:apache-cassandra-0.7.6-2-src aaron$ contrib/stress/bin/stress -d 127.0.0.1 -n 500000 -t 4 -g 1 -o multi_get  
total,interval_op_rate,interval_key_rate,avg_latency,elapsed_time
285425,28542,28542,1.2856967679775774E-4,10
500000,21457,21457,1.2611441221018293E-4,17
aarons-MBP-2011:apache-cassandra-0.7.6-2-src aaron$ contrib/stress/bin/stress -d 127.0.0.1 -n 500000 -t 8 -g 1 -o multi_get  
total,interval_op_rate,interval_key_rate,avg_latency,elapsed_time
425776,42577,42577,1.705732591785352E-4,10
500000,7422,7422,1.7049741323561113E-4,11
aarons-MBP-2011:apache-cassandra-0.7.6-2-src aaron$ contrib/stress/bin/stress -d 127.0.0.1 -n 500000 -t 16 -g 1 -o multi_get  
total,interval_op_rate,interval_key_rate,avg_latency,elapsed_time
450863,45086,45086,3.016193389122638E-4,10
500000,4913,4913,3.1186275108370477E-4,11



aarons-MBP-2011:apache-cassandra-0.7.6-2-src aaron$ contrib/stress/bin/stress -d 127.0.0.1 -n 500000 -t 2 -g 4 -o multi_get  
total,interval_op_rate,interval_key_rate,avg_latency,elapsed_time
119140,11914,47656,1.4768339768339768E-4,10
245923,12678,50713,1.4289770710584226E-4,20
372299,12637,50550,1.4338165474457175E-4,30
499417,12711,50847,1.4287512390062776E-4,40
500000,58,233,1.37221269296741E-4,40
aarons-MBP-2011:apache-cassandra-0.7.6-2-src aaron$ contrib/stress/bin/stress -d 127.0.0.1 -n 500000 -t 2 -g 8 -o multi_get  
total,interval_op_rate,interval_key_rate,avg_latency,elapsed_time
90526,9052,72420,1.9077392130437663E-4,10
185417,9489,75912,1.8588696504410324E-4,20
280382,9496,75972,1.8638445743168535E-4,30
375339,9495,75965,1.8486262202891836E-4,40
470627,9528,76230,1.866342036772731E-4,50
500000,2937,23498,1.8544241310046642E-4,53
aarons-MBP-2011:apache-cassandra-0.7.6-2-src aaron$ contrib/stress/bin/stress -d 127.0.0.1 -n 500000 -t 2 -g 16 -o multi_get  
total,interval_op_rate,interval_key_rate,avg_latency,elapsed_time
63002,6300,100803,2.6664232881495827E-4,10
129152,6615,105840,2.5931972789115646E-4,20
195466,6631,106102,2.589046053623669E-4,30
261841,6637,106200,2.5860640301318265E-4,40
328294,6645,106324,2.5875430755571607E-4,50
394055,6576,105217,2.60382293456608E-4,60
457999,6394,102310,2.685162016764669E-4,70
500000,4200,67201,2.686126520797124E-4,77







clear the recent latency

 ./nodetool -h localhost cfstats 
 

aarons-MBP-2011:cassandra-0.7 aaron$ contrib/stress/bin/stress -d 127.0.0.1 -n 1000000 -t 4 -g 1 -o multi_get
total,interval_op_rate,interval_key_rate,avg_latency,elapsed_time
200946,20094,20094,1.8696067600250813E-4,10
405396,20445,20445,1.8734164832477377E-4,20
611438,20604,20604,1.856563224973549E-4,30
814079,20264,20264,1.8911276592594787E-4,40
1000000,18592,18592,2.03118528837517E-4,50


Keyspace: Keyspace1
	Read Count: 5101500
	Read Latency: 0.040124584926002155 ms.
	Write Count: 1000000
	Write Latency: 0.0073294350000000005 ms.
	Pending Tasks: 0
		Column Family: Standard1
		SSTable count: 1
		Space used (live): 322688987
		Space used (total): 322688987
		Memtable Columns Count: 123785
		Memtable Data Size: 6313035
		Memtable Switch Count: 32
		Read Count: 5101500
		Read Latency: 0.052 ms.
		Write Count: 1000000
		Write Latency: NaN ms.
		Pending Tasks: 0
		Key cache capacity: 200000
		Key cache size: 200000
		Key cache hit rate: 0.5312785312785313
		Row cache: disabled
		Compacted row minimum size: 311
		Compacted row maximum size: 372
		Compacted row mean size: 372
		
storage proxy recent read latency 104 micros


^Caarons-MBP-2011:cassandra-0.7 aaron$ contrib/stress/bin/stress -d 127.0.0.1 -n 1000000 -t 4 -g 5 -o multi_get
total,interval_op_rate,interval_key_rate,avg_latency,elapsed_time
69508,6950,34754,5.451746561546873E-4,10
141576,7206,36034,5.375894988066826E-4,20
213960,7238,36192,5.356984969053935E-4,30
286087,7212,36063,5.372329363483854E-4,40
358155,7206,36034,5.396569906199701E-4,50
427767,6961,34806,5.566568982359364E-4,60
495767,6800,34000,5.711470588235294E-4,70
564331,6856,34282,5.672218657021178E-4,80
632534,6820,34101,5.69549726551618E-4,91
698847,6631,33156,5.868683365252666E-4,101
766444,6759,33798,5.750403124399012E-4,111
832788,6634,33172,5.856897383335343E-4,121
899683,6689,33447,5.795051947081246E-4,131
966432,6674,33374,5.824356919204782E-4,141
1000000,3356,16784,5.810891325071497E-4,146

aarons-MBP-2011:bin aaron$ ./nodetool -h localhost cfstats
Keyspace: Keyspace1
	Read Count: 48256570
	Read Latency: 0.041672221399075816 ms.
	Write Count: 1000000
	Write Latency: 0.0073294350000000005 ms.
	Pending Tasks: 0
		Column Family: Standard1
		SSTable count: 1
		Space used (live): 322688987
		Space used (total): 322688987
		Memtable Columns Count: 123785
		Memtable Data Size: 6313035
		Memtable Switch Count: 32
		Read Count: 48256570
		Read Latency: 0.048 ms.
		Write Count: 1000000
		Write Latency: NaN ms.
		Pending Tasks: 0
		Key cache capacity: 200000
		Key cache size: 200000
		Key cache hit rate: 0.5310891186534712
		Row cache: disabled
		Compacted row minimum size: 311
		Compacted row maximum size: 372
		Compacted row mean size: 372
		
		

Storage proxy 423 micros



aarons-MBP-2011:cassandra-0.7 aaron$ contrib/stress/bin/stress -d 127.0.0.1 -n 1000000 -t 4 -g 10 -o multi_get
total,interval_op_rate,interval_key_rate,avg_latency,elapsed_time
39838,3983,39838,9.542647723279281E-4,10
80355,4051,40517,9.610780659969889E-4,20
121160,4080,40805,9.560838132581792E-4,30
161968,4080,40808,9.562830817486768E-4,40
202366,4039,40398,9.646022080301005E-4,50
243283,4091,40917,9.522447882298311E-4,60
284072,4078,40789,9.556252911324132E-4,70
323378,3930,39306,9.946064214114893E-4,80
361014,3763,37636,0.0010358167711765332,90
400127,3911,39113,9.98261447600542E-4,101
438944,3881,38817,0.0010028853337455239,111
477273,3832,38329,0.0010200109577604426,121
516117,3884,38844,0.0010047883843064566,131
555333,3921,39216,9.965575275397798E-4,141
593438,3810,38105,0.0010254822201810785,151
632049,3861,38611,0.0010097122581647717,161
668621,3657,36572,0.0010684129935469757,171
706961,3834,38340,0.0010176056338028169,181
745403,3844,38442,0.0010172987877841945,192
783414,3801,38011,0.0010280708216042725,202
822582,3916,39168,9.95685253267974E-4,212
861538,3895,38956,0.0010015401991990964,222
900194,3865,38656,0.0010089766142384105,232
938723,3852,38529,0.001015702457888863,242
977743,3902,39020,0.0010018195797027165,252
1000000,2225,22257,0.0010911174012670172,259



aarons-MBP-2011:bin aaron$ ./nodetool -h localhost cfstats
Keyspace: Keyspace1
	Read Count: 58256570
	Read Latency: 0.041917521148258474 ms.
	Write Count: 1000000
	Write Latency: 0.0073294350000000005 ms.
	Pending Tasks: 0
		Column Family: Standard1
		SSTable count: 1
		Space used (live): 322688987
		Space used (total): 322688987
		Memtable Columns Count: 123785
		Memtable Data Size: 6313035
		Memtable Switch Count: 32
		Read Count: 58256570
		Read Latency: 0.043 ms.
		Write Count: 1000000
		Write Latency: NaN ms.
		Pending Tasks: 0
		Key cache capacity: 200000
		Key cache size: 200000
		Key cache hit rate: 0.5308806777926101
		Row cache: disabled
		Compacted row minimum size: 311
		Compacted row maximum size: 372
		Compacted row mean size: 372


storage proxy 812

